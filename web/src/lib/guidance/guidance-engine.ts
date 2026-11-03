// Fuses fixes and motion into the vehicle's position on the route. Times are
// epoch seconds; framework-free so native clients can port it unchanged.

import type { LngLat } from '@/types/map.types'
import { projectLatLng, distanceMeters } from '@/lib/map/movement-interpolation'
import {
  segmentAt,
  smoothedBearingAt,
  stepIndexAt,
  type NavRoute,
} from './nav-route'
import { modeProfile } from './mode-profiles'
import { matchToRoute, type RouteMatch } from './route-matcher'
import { AlongRouteFilter, type FilterOptions } from './along-route-filter'
import { HeadingFilter } from './heading-filter'
import { OffRouteDetector, offRouteOptionsFor } from './off-route'
import { angleDelta } from './spring'
import { drawnLine, drawnPoint } from './route-line'
import { StillnessDetector, YawRateEstimator, type MotionSample } from './motion'
import { Pedometer } from './pedometer'
import { coastSpeed, maneuverLimit, plausibleSpeed, reachAhead } from './dead-reckoning'
import { RelocationVote } from './relocation'

export interface Fix {
  t: number
  position: LngLat
  accuracy: number
  speed: number | null
  heading: number | null
}

export interface PuckState {
  position: LngLat
  bearing: number
  s: number
  speed: number
  snapped: boolean
  stepIndex: number
  /** No usable fix lately: placed by dead reckoning. */
  estimated: boolean
}

export interface EngineDiagnostics {
  lastFix: Fix | null
  /** The latest fix as delivered, however inaccurate. */
  rawFix: Fix | null
  lastMatch: RouteMatch | null
  accepted: boolean
  still: boolean
  /** Motion sensors alone; null without them. */
  sensorStill: boolean | null
  sigma: number
  estimated: boolean
  /** Steps per second; null without a steady walk. */
  cadence: number | null
  stride: number
}

export interface EngineOptions {
  filter?: Partial<FilterOptions>
  /** Below this reported speed (m/s) a fix counts as stationary. */
  stillSpeed?: number
  maxAccuracy?: number
}

const CORRECTION_TIME_CONSTANT = 0.6
const BACKWARD_TOLERANCE = 25
/** Fraction of speed the puck keeps while the estimate catches up from behind. */
const CATCH_UP_CREEP = 0.35
/** A fix this good anchors what the traveller can have reached since. */
const TRUSTED_ACCURACY = 25
/** Coarser than this, a fix says nothing worth folding in. */
const COARSE_LIMIT = 1000
const REACH_MARGIN = 20
/** Without a usable fix for this long, or this many requested intervals, the signal is lost. */
const LOSS_AFTER_SEC = 5
const LOSS_AFTER_INTERVALS = 2.5
const STRIDE_LEARN_SEC = 10

interface Anchor {
  t: number
  s: number
  sigma: number
}

export class GuidanceEngine {
  private route: NavRoute
  private filter: AlongRouteFilter | null = null
  private readonly heading = new HeadingFilter()
  private readonly offRoute = new OffRouteDetector()
  private readonly yaw = new YawRateEstimator()
  private readonly stillness = new StillnessDetector()
  private readonly pedometer = new Pedometer()
  private readonly relocation = new RelocationVote()
  private readonly options: { filter: Partial<FilterOptions>; stillSpeedOverride: number | null; maxAccuracy: number }

  private correction = 0
  private correctionAt = 0
  private renderedS = 0
  private renderedAt: number | null = null
  private stillFixes = 0
  private stillSpeed: number
  private lastFix: Fix | null = null
  private rawFix: Fix | null = null
  private heldS: number | null = null
  private lastMatch: RouteMatch | null = null
  private lastAccepted = true
  private offRoutePosition: { from: LngLat; at: number; correction: LngLat } | null = null

  private trustedFix: Fix | null = null
  private anchor: Anchor | null = null
  private lastGood: { t: number; s: number; v: number } | null = null
  private strideMark: { t: number; s: number } | null = null
  private fixIntervalSec = 1
  private clock = -Infinity
  private estimated = false

  constructor(route: NavRoute, options: EngineOptions = {}) {
    this.route = route
    this.options = {
      filter: options.filter ?? {},
      stillSpeedOverride: options.stillSpeed ?? null,
      maxAccuracy: options.maxAccuracy ?? 50,
    }
    this.stillSpeed = options.stillSpeed ?? modeProfile(route.segments[0]?.mode ?? 'driving').stillSpeed
  }

  get navRoute(): NavRoute {
    return this.route
  }

  get isOffRoute(): boolean {
    return this.offRoute.isOffRoute
  }

  get diagnostics(): EngineDiagnostics {
    return {
      lastFix: this.lastFix,
      rawFix: this.rawFix,
      lastMatch: this.lastMatch,
      accepted: this.lastAccepted,
      still: this.stillFixes >= 2,
      sensorStill: this.stillness.isStill(),
      sigma: this.filter?.positionSigma ?? 0,
      estimated: this.estimated,
      cadence: this.pedometer.cadence(this.clock),
      stride: this.pedometer.stride,
    }
  }

  /** How often fixes were asked for; a gap is only a loss once several are overdue. */
  setFixInterval(ms: number): void {
    this.fixIntervalSec = ms / 1000
  }

  pushMotion(sample: MotionSample): void {
    this.stillness.push(sample)
    this.pedometer.push(sample)
    this.heading.integrate(sample.t, this.yaw.push(sample))
  }

  /** `now` is the wall-clock time the fix is handled; fixes arrive late. */
  pushFix(fix: Fix, now = fix.t): void {
    const at = Math.max(now, fix.t)
    this.rawFix = fix
    this.advance(at)
    if (fix.accuracy > this.options.maxAccuracy) return this.nudge(fix)
    if (!this.reachable(fix)) return this.considerRelocation(fix, now)
    this.relocation.reset()

    const match = this.match(fix)
    if (!match) return

    this.lastFix = fix
    this.lastMatch = match
    this.estimated = false

    const step = this.route.steps[stepIndexAt(this.route, match.s) + 1]
    this.offRoute.configure(offRouteOptionsFor(segmentAt(this.route, match.s)?.mode ?? 'driving'))
    const offRoute = this.offRoute.update({
      offset: match.offset,
      accuracy: fix.accuracy,
      speed: fix.speed,
      courseError: fix.heading == null ? null : angleDelta(match.bearing, fix.heading),
      s: match.s,
      distanceToManeuver: step ? step.startDistance - match.s : Infinity,
    })

    if (offRoute) {
      this.updateOffRoute(fix)
    } else {
      this.offRoutePosition = null
      this.updateOnRoute(fix, match, at)
    }
    this.settle(fix)
  }

  /** The filter's window: around the prediction, never past what the traveller can have reached. */
  private match(fix: Fix): RouteMatch | null {
    const predicted = this.filter?.predict(fix.t)
    const reach = this.reach(fix.t)
    const margin = 2 * fix.accuracy
    let window: { from: number; to: number } | undefined
    if (predicted) {
      const ahead = reach ? Math.max(predicted.s, reach.hi) : predicted.s + Math.max(200, 10 * predicted.v)
      window = { from: predicted.s - 50 - margin, to: ahead + margin }
    } else if (reach) {
      window = { from: reach.lo - margin, to: reach.hi + margin }
    }
    return matchToRoute(this.route, fix.position, {
      window,
      course: fix.speed != null && fix.speed > 3 ? fix.heading : null,
      sigma: fix.accuracy,
    })
  }

  private settle(fix: Fix): void {
    this.lastGood = { t: fix.t, s: this.filter?.state.s ?? this.lastGood?.s ?? 0, v: this.filter?.state.v ?? fix.speed ?? 0 }
    this.estimated = false
    if (fix.accuracy > TRUSTED_ACCURACY && this.trustedFix) return
    this.trustedFix = fix
    if (!this.filter || this.offRoute.isOffRoute) return
    const s = this.filter.state.s
    this.anchor = { t: fix.t, s, sigma: Math.max(fix.accuracy, this.filter.positionSigma) }
    this.learnStride(fix.t, s)
  }

  private learnStride(t: number, s: number): void {
    const mark = this.strideMark
    if (segmentAt(this.route, s)?.mode !== 'walking' || !mark || s < mark.s || t - mark.t > 3 * STRIDE_LEARN_SEC) {
      this.strideMark = { t, s }
      return
    }
    if (t - mark.t < STRIDE_LEARN_SEC) return
    this.pedometer.learnStride(s - mark.s, this.pedometer.stepsBetween(mark.t, t))
    this.strideMark = { t, s }
  }

  /** Route distances the traveller can be between at `t`, given the last trusted fix. */
  private reach(t: number): { lo: number; hi: number } | null {
    const anchor = this.anchor
    if (!anchor) return null
    const dt = Math.max(0, t - anchor.t)
    const slack = anchor.sigma + REACH_MARGIN
    return {
      lo: anchor.s - plausibleSpeed(this.route, anchor.s) * dt - slack,
      hi: reachAhead(this.route, anchor.s, dt) + slack,
    }
  }

  /** Whether the fix lies within travelling distance of the last trusted one. */
  private reachable(fix: Fix): boolean {
    const trusted = this.trustedFix
    if (!trusted) return true
    const from = this.anchor?.s ?? 0
    const range = reachAhead(this.route, from, Math.max(0, fix.t - trusted.t)) - from
    return distanceMeters(trusted.position, fix.position) - trusted.accuracy - fix.accuracy <= range + REACH_MARGIN
  }

  private considerRelocation(fix: Fix, now: number): void {
    if (fix.accuracy > TRUSTED_ACCURACY) return
    const speed = plausibleSpeed(this.route, this.anchor?.s ?? 0)
    if (!this.relocation.offer(fix, speed)) return
    this.relocation.reset()
    this.filter = null
    this.anchor = null
    this.trustedFix = null
    this.offRoute.reset()
    this.offRoutePosition = null
    this.pushFix(fix, now)
  }

  /** A coarse fix may only pull the estimate within its own uncertainty, and within reach. */
  private nudge(fix: Fix): void {
    const filter = this.filter
    if (!filter || this.offRoute.isOffRoute || fix.accuracy > COARSE_LIMIT) return
    const s = filter.state.s
    const reach = this.reach(fix.t)
    const from = Math.max(reach?.lo ?? 0, s - fix.accuracy)
    const to = Math.min(reach?.hi ?? this.route.length, s + fix.accuracy)
    if (to <= from) return
    const match = matchToRoute(this.route, fix.position, { window: { from, to }, sigma: fix.accuracy })
    if (!match || match.offset > fix.accuracy) return
    filter.nudge({ t: Math.max(fix.t, filter.time), s: match.s, sigma: fix.accuracy })
    this.confine(filter, fix.t)
  }

  private confine(filter: AlongRouteFilter, t: number): void {
    const reach = this.reach(t)
    const limit = this.estimated ? this.estimateLimit() : Infinity
    filter.confine(reach?.lo ?? -Infinity, Math.min(reach?.hi ?? Infinity, limit))
  }

  /** How far an estimate may run without a fix confirming it. */
  private estimateLimit(): number {
    return maneuverLimit(this.route, this.lastGood?.s ?? 0)
  }

  private isLost(t: number): boolean {
    const last = this.lastGood
    return last != null && t - last.t > Math.max(LOSS_AFTER_SEC, LOSS_AFTER_INTERVALS * this.fixIntervalSec)
  }

  /** While the signal is lost, carry the estimate on by steps, stillness or a settling speed. */
  private advance(t: number): void {
    this.clock = Math.max(this.clock, t)
    this.estimated = this.isLost(t)
    const filter = this.filter
    const last = this.lastGood
    if (!this.estimated || !filter || !last || t <= filter.time) return
    const coast = coastSpeed({
      mode: segmentAt(this.route, filter.state.s)?.mode ?? 'driving',
      speed: last.v,
      lostFor: t - last.t,
      stepSpeed: this.pedometer.speed(t),
      still: this.stillness.isStill(),
    })
    filter.coast(t, coast.speed, coast.sigma)
    this.confine(filter, t)
  }

  private updateOnRoute(fix: Fix, match: RouteMatch, now: number): void {
    const before = this.filter ? this.renderTarget(now) : null
    const mode = segmentAt(this.route, match.s)?.mode ?? 'driving'
    const profile = modeProfile(mode)
    this.filter?.setJerkSigma(this.options.filter.jerkSigma ?? profile.jerkSigma)
    this.stillSpeed = this.options.stillSpeedOverride ?? profile.stillSpeed

    const still = this.isStill(fix)
    if (!this.filter) {
      this.filter = new AlongRouteFilter(
        { s: match.s, v: fix.speed ?? 0, t: fix.t, sigma: fix.accuracy },
        this.options.filter,
      )
      this.renderedS = match.s
    } else if (still) {
      this.filter.hold(fix.t)
      this.lastAccepted = true
    } else {
      const stepSpeed = mode === 'walking' && fix.accuracy > TRUSTED_ACCURACY ? this.pedometer.speed(fix.t) : null
      this.lastAccepted = this.filter.update({
        t: fix.t,
        s: match.s,
        sigma: Math.max(3, fix.accuracy),
        speed: stepSpeed ?? fix.speed,
      }).accepted
    }
    this.confine(this.filter, fix.t)

    if (before != null) {
      // Carry the visual position across the update; the gap then decays.
      this.correction = before - this.filter.predict(now).s
      this.correctionAt = now
    }
    this.heading.correct(match.bearing, 1)
  }

  private updateOffRoute(fix: Fix): void {
    const course = fix.speed != null && fix.speed > 3 ? fix.heading : null
    if (course != null) this.heading.correct(course, 0.3)
    const previous = this.offRoutePosition
    const rendered = previous ? this.offRoutePoint(fix.t) : fix.position
    this.offRoutePosition = {
      from: fix.position,
      at: fix.t,
      correction: {
        lat: rendered.lat - fix.position.lat,
        lng: rendered.lng - fix.position.lng,
      },
    }
    this.filter = null
  }

  private offRoutePoint(t: number): LngLat {
    const state = this.offRoutePosition
    const fix = this.lastFix
    if (!state || !fix) return fix?.position ?? this.route.points[0]
    const dt = Math.min(5, Math.max(0, t - state.at))
    const decay = Math.exp(-dt / CORRECTION_TIME_CONSTANT)
    const base =
      fix.speed && fix.speed > 0.7 && this.heading.value != null
        ? projectLatLng(state.from, fix.speed, this.heading.value, dt)
        : state.from
    return {
      lat: base.lat + state.correction.lat * decay,
      lng: base.lng + state.correction.lng * decay,
    }
  }

  private isStill(fix: Fix): boolean {
    const sensorStill = this.stillness.isStill()
    const still =
      fix.speed != null
        ? fix.speed < this.stillSpeed && sensorStill !== false
        : sensorStill === true
    this.stillFixes = still ? this.stillFixes + 1 : 0
    return this.stillFixes >= 2
  }

  private renderTarget(t: number): number {
    if (!this.filter) return this.renderedS
    const predicted = this.filter.predict(t).s
    const decay = Math.exp(-Math.max(0, t - this.correctionAt) / CORRECTION_TIME_CONSTANT)
    return predicted + this.correction * decay
  }

  /** Pins the puck at `s` while fixes can't place it; null lets fixes drive it again. */
  hold(s: number | null): void {
    this.heldS = s
  }

  get holding(): boolean {
    return this.heldS != null
  }

  /** The puck for the frame rendered at `t`. */
  sample(t: number): PuckState | null {
    this.advance(t)
    if (this.heldS != null) return this.puckAt(this.heldS, 0)
    if (this.offRoute.isOffRoute && this.offRoutePosition) {
      return {
        position: this.offRoutePoint(t),
        bearing: this.heading.value ?? 0,
        s: this.renderedS,
        speed: this.lastFix?.speed ?? 0,
        snapped: false,
        stepIndex: stepIndexAt(this.route, this.renderedS),
        estimated: this.estimated,
      }
    }
    if (!this.filter) return null

    const speed = this.filter.predict(t).v
    const limit = Math.min(this.route.length, this.estimated ? this.estimateLimit() : Infinity)
    let s = Math.min(limit, this.renderTarget(t))
    // Small backward corrections slow the puck instead of reversing it.
    if (s < this.renderedS && s > this.renderedS - BACKWARD_TOLERANCE) {
      const dt = this.renderedAt == null ? 0 : Math.min(0.1, Math.max(0, t - this.renderedAt))
      s = Math.min(limit, this.renderedS + speed * CATCH_UP_CREEP * dt)
    }
    this.renderedS = s
    this.renderedAt = t
    return this.puckAt(s, speed)
  }

  private puckAt(s: number, speed: number): PuckState {
    const window = Math.max(5, speed * 0.75)
    return {
      position: drawnPoint(this.route, s),
      bearing: smoothedBearingAt(drawnLine(this.route), s, window),
      s,
      speed,
      snapped: true,
      stepIndex: stepIndexAt(this.route, s),
      estimated: this.estimated,
    }
  }

  /** Swap in a new route (reroute) keeping the vehicle's speed. */
  setRoute(route: NavRoute): void {
    const speed = this.filter?.state.v ?? 0
    const t = this.filter?.time ?? 0
    this.route = route
    this.filter = null
    this.heldS = null
    this.offRoute.reset()
    this.offRoutePosition = null
    this.relocation.reset()
    this.anchor = null
    this.strideMark = null
    this.correction = 0
    this.renderedS = 0
    if (this.lastFix) {
      const match = matchToRoute(route, this.lastFix.position, { sigma: this.lastFix.accuracy })
      if (match) {
        this.filter = new AlongRouteFilter({ s: match.s, v: speed, t, sigma: this.lastFix.accuracy }, this.options.filter)
        this.renderedS = match.s
      }
    }
    if (this.lastGood) this.lastGood = { ...this.lastGood, s: this.renderedS }
  }
}
