// When to speak: each maneuver gets up to three prompts whose lead distances
// grow with speed, so a highway exit is announced a mile out and a footpath
// turn a few steps before it.

import type { LngLat } from '@/types/map.types'
import { bearingDeg } from '@/lib/map/movement-interpolation'
import { maneuverKind } from '@/lib/directions/maneuver'
import { pointAt, bearingAt, type NavRoute, type NavStep } from './nav-route'
import type { PuckState } from './guidance-engine'
import { angleDelta } from './spring'
import { travelModeAt } from './guidance-display'
import { crosswalkAfter, upcomingHazard } from './hazards'
import { modeProfile } from './mode-profiles'
import type { NavHazard } from './nav-route'
import type { Handoff } from './handoff'

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
  | { kind: 'reroute' }

/** Turn prompts are guidance; everything else is an alert, spoken in "alerts only" too. */
export function isAlert(announcement: Announcement): boolean {
  return announcement.kind !== 'maneuver'
}

const PREPARE_SEC = 115
const APPROACH_SEC = 22
const MIN_NOW_METERS = 12
const CONTINUE_OVER_METERS = 2000
const THEN_WITHIN_METERS = 100
/** Early prompts wait this long after the previous maneuver, so they don't talk over it. */
const MIN_GAP_SEC = 8

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

  constructor(
    private route: NavRoute,
    private destination: LngLat | null,
  ) {}

  setRoute(route: NavRoute): void {
    this.route = route
    this.fired.clear()
    this.lastStepIndex = -1
  }

  private once(key: string): boolean {
    if (this.fired.has(key)) return false
    this.fired.add(key)
    return true
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
      if (phase !== 'now' && !settled) continue
      for (const [earlier] of phases.slice(0, i)) this.fired.add(`${earlier}:${next.index}`)
      if (!this.once(`${phase}:${next.index}`)) break
      if (arriving) {
        if (phase !== 'now') due.push({ kind: 'arrive', distance, side })
      } else {
        const after = route.steps[next.index + 1]
        const then =
          phase === 'now' && after && after.startDistance - next.startDistance <= THEN_WITHIN_METERS ? after : null
        const pedestrians = phase === 'now' && mode === 'driving' && crosswalkAfter(route, next) != null
        due.push({ kind: 'maneuver', phase, step: next, distance, then, pedestrians })
      }
      break
    }

    const ahead = upcomingHazard(route, puck.s, puck.speed)
    if (ahead && this.once(`hazard:${ahead.hazard.kind}:${Math.round(ahead.hazard.startDistance)}`)) {
      due.push({ kind: 'hazard', hazard: ahead.hazard, distance: ahead.distance })
    }
    return due
  }
}
