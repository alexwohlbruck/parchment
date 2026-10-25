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
import { OffRouteDetector } from './off-route'
import { drawnLine, drawnPoint } from './route-line'
import { StillnessDetector, YawRateEstimator, type MotionSample } from './motion'

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
}

export interface EngineDiagnostics {
  lastFix: Fix | null
  lastMatch: RouteMatch | null
  accepted: boolean
  still: boolean
  sigma: number
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
const MAX_PLAUSIBLE_SPEED = 70

export class GuidanceEngine {
  private route: NavRoute
  private filter: AlongRouteFilter | null = null
  private readonly heading = new HeadingFilter()
  private readonly offRoute = new OffRouteDetector()
  private readonly yaw = new YawRateEstimator()
  private readonly stillness = new StillnessDetector()
  private readonly options: { filter: Partial<FilterOptions>; stillSpeedOverride: number | null; maxAccuracy: number }

  private correction = 0
  private correctionAt = 0
  private renderedS = 0
  private renderedAt: number | null = null
  private stillFixes = 0
  private stillSpeed: number
  private jumpRejections = 0
  private lastFix: Fix | null = null
  private lastMatch: RouteMatch | null = null
  private lastAccepted = true
  private offRoutePosition: { from: LngLat; at: number; correction: LngLat } | null = null

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
      lastMatch: this.lastMatch,
      accepted: this.lastAccepted,
      still: this.stillFixes >= 2,
      sigma: this.filter?.positionSigma ?? 0,
    }
  }

  pushMotion(sample: MotionSample): void {
    this.stillness.push(sample)
    this.heading.integrate(sample.t, this.yaw.push(sample))
  }

  /** `now` is the wall-clock time the fix is handled; fixes arrive late. */
  pushFix(fix: Fix, now = fix.t): void {
    if (fix.accuracy > this.options.maxAccuracy) return
    if (this.lastFix && this.isImplausibleJump(this.lastFix, fix)) {
      // A real relocation (tunnel exit, cold GPS) repeats; a glitch doesn't.
      if (++this.jumpRejections < 2) return
    }
    this.jumpRejections = 0

    const predicted = this.filter?.predict(fix.t)
    const searchFrom = predicted ? predicted.s - 50 - 2 * fix.accuracy : 0
    const searchTo = predicted
      ? predicted.s + Math.max(200, 10 * predicted.v) + 2 * fix.accuracy
      : this.route.length
    const match = matchToRoute(this.route, fix.position, {
      window: predicted ? { from: searchFrom, to: searchTo } : undefined,
      course: fix.speed != null && fix.speed > 3 ? fix.heading : null,
      sigma: fix.accuracy,
    })
    if (!match) return

    this.lastFix = fix
    this.lastMatch = match

    const step = this.route.steps[stepIndexAt(this.route, match.s) + 1]
    const offRoute = this.offRoute.update({
      offset: match.offset,
      accuracy: fix.accuracy,
      speed: fix.speed,
      courseError: match.courseError,
      s: match.s,
      distanceToManeuver: step ? step.startDistance - match.s : Infinity,
    })

    if (offRoute) {
      this.updateOffRoute(fix)
      return
    }
    this.offRoutePosition = null
    this.updateOnRoute(fix, match, Math.max(now, fix.t))
  }

  private updateOnRoute(fix: Fix, match: RouteMatch, now: number): void {
    const before = this.filter ? this.renderTarget(now) : null
    const profile = modeProfile(segmentAt(this.route, match.s)?.mode ?? 'driving')
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
      this.lastAccepted = this.filter.update({
        t: fix.t,
        s: match.s,
        sigma: Math.max(3, fix.accuracy),
        speed: fix.speed,
      }).accepted
    }

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

  private isImplausibleJump(prev: Fix, next: Fix): boolean {
    const dt = next.t - prev.t
    if (dt <= 0) return true
    const d = distanceMeters(prev.position, next.position)
    return d - next.accuracy - prev.accuracy > MAX_PLAUSIBLE_SPEED * dt
  }

  private renderTarget(t: number): number {
    if (!this.filter) return this.renderedS
    const predicted = this.filter.predict(t).s
    const decay = Math.exp(-Math.max(0, t - this.correctionAt) / CORRECTION_TIME_CONSTANT)
    return predicted + this.correction * decay
  }

  /** The puck for the frame rendered at `t`. */
  sample(t: number): PuckState | null {
    if (this.offRoute.isOffRoute && this.offRoutePosition) {
      return {
        position: this.offRoutePoint(t),
        bearing: this.heading.value ?? 0,
        s: this.renderedS,
        speed: this.lastFix?.speed ?? 0,
        snapped: false,
        stepIndex: stepIndexAt(this.route, this.renderedS),
      }
    }
    if (!this.filter) return null

    const speed = this.filter.predict(t).v
    let s = Math.min(this.route.length, this.renderTarget(t))
    // Small backward corrections slow the puck instead of reversing it.
    if (s < this.renderedS && s > this.renderedS - BACKWARD_TOLERANCE) {
      const dt = this.renderedAt == null ? 0 : Math.min(0.1, Math.max(0, t - this.renderedAt))
      s = Math.min(this.route.length, this.renderedS + speed * CATCH_UP_CREEP * dt)
    }
    this.renderedS = s
    this.renderedAt = t

    const window = Math.max(5, speed * 0.75)
    return {
      position: drawnPoint(this.route, s),
      bearing: smoothedBearingAt(drawnLine(this.route), s, window),
      s,
      speed,
      snapped: true,
      stepIndex: stepIndexAt(this.route, s),
    }
  }

  /** Swap in a new route (reroute) keeping the vehicle's speed. */
  setRoute(route: NavRoute): void {
    const speed = this.filter?.state.v ?? 0
    const t = this.filter?.time ?? 0
    this.route = route
    this.filter = null
    this.offRoute.reset()
    this.offRoutePosition = null
    this.correction = 0
    this.renderedS = 0
    if (this.lastFix) {
      const match = matchToRoute(route, this.lastFix.position, { sigma: this.lastFix.accuracy })
      if (match) {
        this.filter = new AlongRouteFilter({ s: match.s, v: speed, t, sigma: this.lastFix.accuracy }, this.options.filter)
        this.renderedS = match.s
      }
    }
  }
}
