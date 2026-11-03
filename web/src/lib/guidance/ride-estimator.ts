// Where a rider is along a transit ride once fixes stop coming, as underground:
// the timetable carries the estimate, sensed station dwells and fresh fixes correct it.

import { matchToRoute } from './route-matcher'
import { STOP_PASSED_METERS, type RideStop } from './transit-progress'
import type { Fix, PuckState } from './guidance-engine'
import type { NavRoute, NavSegment } from './nav-route'

export interface RideFix {
  /** Epoch ms on the timetable's clock. */
  t: number
  /** Distance along the route. */
  s: number
  accuracy: number
  /** Metres from the fix to the line. */
  offset: number
}

export interface RideObservation {
  now: number
  fix: RideFix | null
  /** From the motion sensors; null without them. */
  still: boolean | null
}

export interface RideEstimate {
  s: number
  /** 0–1. */
  confidence: number
  /** A precise fix is recent enough to follow directly. */
  fresh: boolean
  /** Where the puck can honestly sit: the last stop reached, or a later fix. */
  shownS: number
}

export const PRECISE_ACCURACY = 50
const COARSE_ACCURACY = 1000
const FRESH_MS = 10_000
const STALE_MS = 30_000
/** Standing still this long is a station dwell, not a pause in traffic. */
export const DWELL_MIN_MS = 12_000
const MOVING_MIN_MS = 3_000
const AT_STOP_METERS = 40
const DWELL_CONFIDENCE = 0.8
const COARSE_CONFIDENCE = 0.6
const SCHEDULE_CONFIDENCE = 0.5
const LOW_CONFIDENCE = 0.4

interface Trust {
  /** How far a dwell may be from a stop's expected time and still be that stop. */
  windowMs: number
  /** Cost of a dwell matching past stops it never stopped at. */
  skipMs: number
  /** Past a stop's expected time by this without a dwell, the vehicle ran through it. */
  runThroughMs: number
  /** Confidence decays with this time constant after the last anchor. */
  decayMs: number
}

const REALTIME_TRUST: Trust = { windowMs: 120_000, skipMs: 15_000, runThroughMs: 30_000, decayMs: 300_000 }
const SCHEDULE_TRUST: Trust = { windowMs: 240_000, skipMs: 45_000, runThroughMs: 60_000, decayMs: 150_000 }

interface Timed {
  s: number
  arrive: number
  depart: number
}

/** Stop times with gaps filled in by distance, or null when fewer than two are known. */
function timetable(stops: RideStop[]): Timed[] | null {
  const known = stops.flatMap((stop, i) => (stop.timeMs != null ? [i] : []))
  if (known.length < 2) return null
  return stops.map((stop, i) => {
    if (stop.timeMs != null) return { s: stop.s, arrive: stop.timeMs, depart: Math.max(stop.timeMs, stop.departureMs ?? stop.timeMs) }
    const before = known.filter(k => k < i).at(-1) ?? known[0]
    const after = known.find(k => k > i) ?? known.at(-1)!
    const [a, b] = before === after ? [known[0], known[1]] : [before, after]
    const span = stops[b].s - stops[a].s
    const f = span > 0 ? (stop.s - stops[a].s) / span : 0
    const t = stops[a].timeMs! + f * (stops[b].timeMs! - stops[a].timeMs!)
    return { s: stop.s, arrive: t, depart: t }
  })
}

function positionAt(table: Timed[], t: number): number {
  if (t <= table[0].depart) return table[0].s
  for (let k = 0; k < table.length - 1; k++) {
    const from = table[k]
    const to = table[k + 1]
    if (t <= from.depart) return from.s
    if (t < to.arrive) return from.s + ((to.s - from.s) * (t - from.depart)) / Math.max(1, to.arrive - from.depart)
  }
  return table.at(-1)!.s
}

/** When the timetable has the vehicle at `s`; at a stop, when it leaves. */
function timeAt(table: Timed[], s: number): number {
  for (let k = 0; k < table.length - 1; k++) {
    const from = table[k]
    const to = table[k + 1]
    if (s < to.s) {
      const f = to.s > from.s ? Math.max(0, s - from.s) / (to.s - from.s) : 0
      return from.depart + f * (to.arrive - from.depart)
    }
  }
  return table.at(-1)!.arrive
}

export class RideEstimator {
  private readonly table: Timed[] | null
  private readonly trust: Trust
  private lag = 0
  /** Position held while the timetable can't move it: no timetable, or standing still. */
  private held: number
  private reached = 0
  private fixS: number | null = null
  private lastFixT = -Infinity
  private preciseAt = -Infinity
  private anchor: { t: number; confidence: number }
  private stillSince: number | null = null
  private movingSince: number | null = null
  private dwell: { stop: number | null } | null = null
  private sensing = false

  constructor(
    private readonly stops: RideStop[],
    start: { s: number; t: number },
    { realtime = false } = {},
  ) {
    this.table = timetable(stops)
    this.trust = realtime ? REALTIME_TRUST : SCHEDULE_TRUST
    this.held = start.s
    this.anchor = { t: start.t, confidence: SCHEDULE_CONFIDENCE }
    this.reached = this.stopReachedAt(start.s)
    if (this.table) this.lag = start.t - timeAt(this.table, start.s)
  }

  update({ now, fix, still }: RideObservation): RideEstimate {
    if (fix && fix.t > this.lastFixT && now - fix.t <= STALE_MS) {
      this.lastFixT = fix.t
      this.observeFix(fix, now)
    }
    this.observeMotion(now, still)
    const s = this.position(now)
    const fresh = now - this.preciseAt <= FRESH_MS
    const passed = this.stops[this.stopReachedAt(s)]?.s ?? s
    return {
      s,
      confidence: fresh ? 1 : this.confidence(now),
      fresh,
      shownS: Math.max(passed, Math.min(s, this.fixS ?? -Infinity)),
    }
  }

  private position(now: number): number {
    if (this.dwell || !this.table) return this.held
    const s = this.clamp(positionAt(this.table, now - this.lag))
    return this.sensing ? Math.min(s, this.awaitedStopS(this.table, now)) : s
  }

  /** With dwells observable, the estimate waits short of the next stop until one is sensed there or it is clearly passed. */
  private awaitedStopS(table: Timed[], now: number): number {
    let k = this.reached + 1
    while (k < table.length && now > table[k].arrive + this.lag + this.trust.runThroughMs) k++
    return k < table.length ? this.stops[k].s - STOP_PASSED_METERS - 1 : Infinity
  }

  private confidence(now: number): number {
    if (this.dwell?.stop != null) return this.anchor.confidence
    return this.anchor.confidence * Math.exp(-Math.max(0, now - this.anchor.t) / this.trust.decayMs)
  }

  private observeFix(fix: RideFix, now: number): void {
    if (fix.accuracy > COARSE_ACCURACY || fix.offset > fix.accuracy + AT_STOP_METERS) return
    if (fix.accuracy <= PRECISE_ACCURACY) return this.placeAt(this.clamp(fix.s), fix.t)
    const estimate = this.position(now)
    if (Math.abs(estimate - fix.s) <= fix.accuracy) return
    const stop = this.nearestStop(fix.s, fix.accuracy)
    if (stop != null) this.arriveAt(stop, fix.t, COARSE_CONFIDENCE)
  }

  /** A precise fix: the rider is at `s` at `t`. */
  private placeAt(s: number, t: number): void {
    this.preciseAt = t
    this.fixS = s
    this.held = s
    this.reached = this.stopReachedAt(s)
    this.anchor = { t, confidence: 1 }
    if (this.dwell) this.dwell = { stop: this.atStop(s) }
    else if (this.table) this.lag = t - timeAt(this.table, s)
  }

  /** At `stop` at `t`, having just pulled in. */
  private arriveAt(stop: number, t: number, confidence: number): void {
    this.reached = stop
    this.fixS = null
    this.held = this.stops[stop].s
    this.anchor = { t, confidence }
    if (this.table) this.lag = t - this.table[stop].arrive
  }

  private observeMotion(now: number, still: boolean | null): void {
    if (still == null) return
    this.sensing = true
    if (still) {
      this.movingSince = null
      this.stillSince ??= now
      if (!this.dwell && now - this.stillSince >= DWELL_MIN_MS) this.startDwell(this.stillSince)
      return
    }
    this.movingSince ??= now
    if (now - this.movingSince < MOVING_MIN_MS) return
    this.stillSince = null
    if (this.dwell) this.endDwell(this.movingSince)
  }

  private startDwell(t: number): void {
    const stop = this.matchDwell(t)
    if (stop != null) {
      this.arriveAt(stop, t, DWELL_CONFIDENCE)
    } else {
      this.held = this.position(t)
    }
    this.dwell = { stop }
  }

  private endDwell(t: number): void {
    this.dwell = null
    this.anchor = { ...this.anchor, t }
    if (this.table) this.lag = t - timeAt(this.table, this.held)
  }

  /**
   * The stop a dwell starting at `t` is at. The timetable decides, realtime-adjusted
   * where the trip has it; counting stops in order only breaks ties.
   */
  private matchDwell(t: number): number | null {
    const next = this.reached + 1
    const estimate = this.position(t)
    const current = this.stops[this.reached]
    if (current && estimate - current.s < AT_STOP_METERS) return this.reached
    if (next >= this.stops.length) return null
    if (!this.table) return next
    let best: { stop: number; cost: number } | null = null
    for (let k = next; k < this.stops.length; k++) {
      const miss = Math.abs(t - (this.table[k].arrive + this.lag))
      if (miss > this.trust.windowMs) continue
      const cost = miss + (k - next) * this.trust.skipMs
      if (!best || cost < best.cost) best = { stop: k, cost }
    }
    return best?.stop ?? null
  }

  private nearestStop(s: number, within: number): number | null {
    let best: number | null = null
    for (let k = this.reached; k < this.stops.length; k++) {
      const d = Math.abs(this.stops[k].s - s)
      if (d <= within && (best == null || d < Math.abs(this.stops[best].s - s))) best = k
    }
    return best
  }

  private atStop(s: number): number | null {
    const k = this.stops.findIndex(stop => Math.abs(stop.s - s) < AT_STOP_METERS)
    return k < 0 ? null : k
  }

  private stopReachedAt(s: number): number {
    let reached = 0
    this.stops.forEach((stop, k) => {
      if (stop.s <= s + STOP_PASSED_METERS) reached = k
    })
    return reached
  }

  private clamp(s: number): number {
    return Math.min(this.stops.at(-1)?.s ?? s, Math.max(this.stops[0]?.s ?? s, s))
  }
}

/** A fix placed on the ride, with its time moved onto the timetable's clock. */
export function rideFix(route: NavRoute, ride: NavSegment, fix: Fix, clockOffsetMs: number): RideFix | null {
  const match = matchToRoute(route, fix.position, { window: { from: ride.startDistance, to: ride.endDistance }, sigma: fix.accuracy })
  if (!match) return null
  return { t: fix.t * 1000 + clockOffsetMs, s: match.s, accuracy: fix.accuracy, offset: match.offset }
}

/** The puck transit progress should judge: the engine's while fixes are fresh, else the estimate, which can't be off the line. */
export function estimatedPuck(puck: PuckState, estimate: RideEstimate): PuckState {
  return estimate.fresh ? puck : { ...puck, s: estimate.s, snapped: true }
}

export type RideCertainty = 'live' | 'estimated' | 'uncertain'

export function rideCertainty(estimate: RideEstimate | null): RideCertainty {
  if (!estimate || estimate.fresh) return 'live'
  return estimate.confidence >= LOW_CONFIDENCE ? 'estimated' : 'uncertain'
}
