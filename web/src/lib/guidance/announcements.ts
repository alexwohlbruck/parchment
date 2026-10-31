// When to speak: each maneuver gets up to three prompts whose lead distances
// grow with speed, so a highway exit is announced a mile out and a footpath
// turn a few steps before it.

import type { LngLat } from '@/types/map.types'
import { bearingDeg } from '@/lib/map/movement-interpolation'
import { maneuverKind } from '@/lib/directions/maneuver'
import { pointAt, bearingAt, type NavRoute, type NavStep } from './nav-route'
import type { PuckState } from './guidance-engine'
import type { TransitEvent } from './transit-progress'
import { angleDelta } from './spring'
import { travelModeAt } from './guidance-display'
import { crosswalkAfter, upcomingHazard } from './hazards'
import { modeProfile } from './mode-profiles'
import type { NavHazard } from './nav-route'
import type { Handoff } from './handoff'
import { cardinal, type Cardinal } from './turn-around'
import { borderCrossings, type BorderCrossing } from './instructions/borders'
import { targetRoad } from './instructions/rich-instruction'

export type AnnouncementPhase = 'prepare' | 'approach' | 'now' | 'continue'

export type Announcement =
  | {
      kind: 'maneuver'
      phase: AnnouncementPhase
      step: NavStep
      distance: number
      then: NavStep | null
      /** A crosswalk on the road being turned onto. */
      pedestrians?: boolean
    }
  | { kind: 'hazard'; hazard: NavHazard; distance: number }
  | { kind: 'handoff'; handoff: Handoff }
  | { kind: 'arrive'; distance: number; side: 'left' | 'right' | null }
  | { kind: 'arrived'; side: 'left' | 'right' | null }
  | { kind: 'start'; heading: Cardinal; road: string | null; step: NavStep | null; then?: NavStep | null }
  | { kind: 'reroute' }
  | { kind: 'turn-around'; heading: Cardinal; road: string | null }
  | { kind: 'dock-switch'; station: string }
  | { kind: 'transit'; event: TransitEvent; line: string; headsign?: string; stop: string }
  /** Entering another country, state or province; `region` is its name. */
  | { kind: 'border'; region: string }
  /** `vehicle` names the mode, as in "Which train are you on?". */
  | { kind: 'vehicle-question'; vehicle: string }

/** Turn prompts and welcomes are guidance; everything else is an alert, spoken in "alerts only" too. */
export function isAlert(announcement: Announcement): boolean {
  return announcement.kind !== 'maneuver' && announcement.kind !== 'border'
}

const PREPARE_SEC = 115
const APPROACH_SEC = 22
const MIN_NOW_METERS = 12
const CONTINUE_OVER_METERS = 2000
/** Early prompts wait this long after the previous maneuver, so they don't talk over it. */
const MIN_GAP_SEC = 8
/** A border passed further back than this goes unwelcomed, as after a reroute. */
const BORDER_WINDOW_METERS = 300

export interface AnnouncerOptions {
  /** Names a country from its alpha-3 code; without it, borders, state ones too, pass unannounced. */
  regionName?: (country: string) => string | null
}

export function leadDistances(mode: string, speed: number) {
  const v = Math.max(modeProfile(mode).baseSpeed, speed)
  return {
    prepare: mode === 'walking' ? null : v * PREPARE_SEC,
    approach: v * APPROACH_SEC,
    now: Math.max(MIN_NOW_METERS, v * Math.min(Math.sqrt(3.6 * v), 8)),
  }
}

/** Which side of the road the destination is on, from the route's last bearing. */
export function destinationSide(route: NavRoute, destination: LngLat | null): 'left' | 'right' | null {
  if (!destination || route.points.length < 2) return null
  const end = pointAt(route, route.length)
  const toDestination = bearingDeg(end, destination)
  const offset = angleDelta(bearingAt(route, route.length), toDestination)
  if (Math.abs(offset) < 20 || Math.abs(offset) > 160) return null
  return offset > 0 ? 'right' : 'left'
}

export class Announcer {
  private fired = new Set<string>()
  private lastStepIndex = -1
  private speechUntil = 0
  private borders: BorderCrossing[]

  constructor(
    private route: NavRoute,
    private destination: LngLat | null,
    private speechSeconds: (announcement: Announcement, available?: number) => number = () => 4,
    private options: AnnouncerOptions = {},
  ) {
    this.borders = options.regionName ? borderCrossings(route) : []
  }

  setRoute(route: NavRoute): void {
    this.route = route
    this.borders = this.options.regionName ? borderCrossings(route) : []
    this.fired.clear()
    this.lastStepIndex = -1
    this.speechUntil = 0
  }

  private once(key: string): boolean {
    if (this.fired.has(key)) return false
    this.fired.add(key)
    return true
  }

  start(): Announcement | null {
    if (this.route.points.length < 2 || !this.once('start')) return null
    const step = this.route.steps.find(step => step.startDistance <= MIN_NOW_METERS) ?? null
    const next = this.route.steps[1]
    if (next) this.fired.add(`continue:${next.index}`)
    const initial: Announcement = {
      kind: 'start',
      heading: cardinal(bearingAt(this.route, 0)),
      road: startRoad(this.route, step),
      step,
    }
    this.combine(initial, 0, modeProfile(travelModeAt(this.route, 0)).baseSpeed)
    return initial
  }

  private cover(step: NavStep) {
    for (const phase of ['continue', 'prepare', 'approach', 'now']) this.fired.add(`${phase}:${step.index}`)
  }

  private combine(announcement: Announcement, s: number, speed: number) {
    if (announcement.kind !== 'start' && announcement.kind !== 'maneuver') return
    const v = speed > 0.5 ? speed : modeProfile(travelModeAt(this.route, s)).baseSpeed
    const next = this.route.steps[(announcement.step?.index ?? 0) + 1]
    const deadline = announcement.kind === 'maneuver' && announcement.phase !== 'now' ? announcement.step : next
    const seconds = this.speechSeconds(announcement, deadline ? (deadline.startDistance - s) / v : undefined) + 2
    if ((announcement.kind === 'start' || announcement.phase === 'now') && next
      && maneuverKind(next.instruction) !== 'arrive'
      && next.segmentIndex === announcement.step?.segmentIndex
      && next.startDistance - s - leadDistances(travelModeAt(this.route, s), v).now <= v * seconds) {
      announcement.then = next
      this.cover(next)
    }
    this.speechUntil = s + v * (this.speechSeconds(announcement) + 2)
  }

  /** Prompts due at this puck position, in speaking order. */
  update(puck: PuckState): Announcement[] {
    const route = this.route
    const due: Announcement[] = []
    const mode = travelModeAt(route, puck.s)
    const lead = leadDistances(mode, puck.speed)
    const remaining = route.length - puck.s
    const side = destinationSide(route, this.destination)

    if (remaining <= MIN_NOW_METERS * 2) {
      if (this.once('arrived')) due.push({ kind: 'arrived', side })
      return due
    }

    const next = route.steps[puck.stepIndex + 1]
    if (!next) return due
    const distance = next.startDistance - puck.s
    const arriving = maneuverKind(next.instruction) === 'arrive'
    const stepStart = route.steps[puck.stepIndex]?.startDistance ?? 0
    const stepLength = next.startDistance - stepStart
    const settled = puck.s - stepStart >= Math.min(MIN_GAP_SEC * Math.max(1, puck.speed), stepLength / 3)

    if (puck.stepIndex !== this.lastStepIndex) {
      this.lastStepIndex = puck.stepIndex
      if (distance > CONTINUE_OVER_METERS && this.once(`continue:${next.index}`)) {
        due.push({ kind: 'maneuver', phase: 'continue', step: next, distance, then: null })
      }
    }

    const phases: [AnnouncementPhase, number | null][] = [
      ['prepare', lead.prepare],
      ['approach', lead.approach],
      ['now', lead.now],
    ]
    // Only the nearest due phase speaks; skipped earlier ones are marked spent.
    for (let i = phases.length - 1; i >= 0; i--) {
      const [phase, at] = phases[i]
      if (at == null || distance > at) continue
      if (phase !== 'now' && (!settled || puck.s < this.speechUntil)) continue
      for (const [earlier] of phases.slice(0, i)) this.fired.add(`${earlier}:${next.index}`)
      if (!this.once(`${phase}:${next.index}`)) break
      if (arriving) {
        if (phase !== 'now') due.push({ kind: 'arrive', distance, side })
      } else {
        const pedestrians = phase === 'now' && mode === 'driving' && crosswalkAfter(route, next) != null
        const announcement: Announcement = { kind: 'maneuver', phase, step: next, distance, then: null, pedestrians }
        this.combine(announcement, puck.s, puck.speed)
        due.push(announcement)
      }
      break
    }

    const border = this.borders.find(b => puck.s >= b.s && puck.s - b.s <= BORDER_WINDOW_METERS)
    const region = border && (border.state ?? this.options.regionName?.(border.country))
    if (border && region && this.once(`border:${Math.round(border.s)}`)) due.push({ kind: 'border', region })

    const ahead = upcomingHazard(route, puck.s, puck.speed)
    if (ahead && this.once(`hazard:${ahead.hazard.kind}:${Math.round(ahead.hazard.startDistance)}`)) {
      due.push({ kind: 'hazard', hazard: ahead.hazard, distance: ahead.distance })
    }
    return due
  }
}

function startRoad(route: NavRoute, step: NavStep | null): string | null {
  const road = step && targetRoad(route, step)
  return road?.kind === 'named' ? road.name : null
}
