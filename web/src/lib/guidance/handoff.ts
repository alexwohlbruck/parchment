// The moment one segment of a leg gives way to the next: what to tell the
// traveller, and when.

import { segmentAt, type NavRoute } from './nav-route'
import type { PuckState } from './guidance-engine'
import { modeProfile } from './mode-profiles'

export interface HandoffSegment {
  mode: string
  ownership?: string
  duration?: number
  end?: { label?: string }
  sharedMobilityDetails?: { stationName?: string; toStationName?: string; availableDocks?: number; provider?: string } | null
}

export type HandoffKind = 'park' | 'lock-bike' | 'dock-bike' | 'unlock-bike' | 'get-in-car' | 'get-on-bike' | 'continue'

export interface Handoff {
  /** Index of the segment being left. */
  from: number
  kind: HandoffKind
  nextMode: string
  /** Planned seconds of the segment that follows. */
  nextDuration: number
  /** Where the next segment ends, when the planner named it. */
  nextEnd?: string
  station?: string
  docks?: number
}

/** After this long at walking pace, a drive or ride is over even short of its end. */
export const STOPPED_HANDOFF_SEC = 20
const STOPPED_SPEED = 2
const STOPPED_WITHIN_METERS = 300

function kindFor(from: HandoffSegment, to: HandoffSegment): HandoffKind {
  const fromMode = from.mode === 'biking' ? 'cycling' : from.mode
  const toMode = to.mode === 'biking' ? 'cycling' : to.mode
  if (fromMode === 'driving') return 'park'
  if (fromMode === 'cycling') return from.ownership === 'shared' ? 'dock-bike' : 'lock-bike'
  if (toMode === 'cycling') return to.ownership === 'shared' ? 'unlock-bike' : 'get-on-bike'
  if (toMode === 'driving') return 'get-in-car'
  return 'continue'
}

export function describeHandoff(segments: HandoffSegment[], from: number): Handoff | null {
  const current = segments[from]
  const next = segments[from + 1]
  if (!current || !next) return null
  const kind = kindFor(current, next)
  const shared = kind === 'dock-bike' ? current.sharedMobilityDetails : kind === 'unlock-bike' ? next.sharedMobilityDetails : null
  return {
    from,
    kind,
    nextMode: next.mode,
    nextDuration: next.duration ?? 0,
    nextEnd: next.end?.label,
    station: kind === 'dock-bike' ? shared?.toStationName ?? shared?.stationName : shared?.stationName,
    docks: kind === 'dock-bike' ? shared?.availableDocks : undefined,
  }
}

/**
 * The handoff due at this position: near the end of a segment that isn't the
 * last, or once a drive or ride has stopped at walking pace close to its end.
 */
export function dueHandoff(
  route: NavRoute,
  puck: PuckState,
  segments: HandoffSegment[],
  slowForSec: number,
): Handoff | null {
  const segment = segmentAt(route, puck.s)
  if (!segment || segment.index >= route.segments.length - 1) return null
  const left = segment.endDistance - puck.s
  const profile = modeProfile(segment.mode)
  const stopped =
    segment.mode !== 'walking' && slowForSec >= STOPPED_HANDOFF_SEC && left <= STOPPED_WITHIN_METERS
  if (left > profile.handoffRadius && !stopped) return null
  // Live transit guidance owns the stop: waiting, boarding and getting off.
  if (segment.mode === 'transit' || segments[segment.index + 1]?.mode === 'transit') return null
  return describeHandoff(segments, segment.index)
}

/** Tracks how long the traveller has been at walking pace. */
export function slowDuration(previous: number, speed: number, dtSec: number): number {
  return speed < STOPPED_SPEED ? previous + dtSec : 0
}
