// Where a rider is on a transit leg: walking to the stop, waiting, riding,
// or past the point where the plan still works.

import { distanceAlong, segmentAt, type NavRoute, type NavSegmentInput } from './nav-route'
import type { PuckState } from './guidance-engine'
import { modeProfile } from './mode-profiles'
import type { LngLat } from '@/types/map.types'

export interface TransitStopInput {
  id?: string
  name: string
  location?: LngLat
  arrivalTime?: string | Date
  departureTime?: string | Date
}

export interface TransitSegmentInput {
  mode: string
  startTime?: string | Date
  endTime?: string | Date
  lineName?: string
  headsign?: string
  departureStop?: TransitStopInput
  arrivalStop?: TransitStopInput
  intermediateStops?: TransitStopInput[]
}

export interface RideStop {
  /** The stop's timetable id, else its name. */
  key: string
  name: string
  s: number
  timeMs: number | null
}

interface StageBase {
  segmentIndex: number
}

export type TransitStage = StageBase &
  (
    | { kind: 'to-stop' | 'wait' | 'missed-vehicle'; stop: string; departureMs: number }
    | {
        kind: 'riding'
        /** Stops still ahead, counting the one to get off at. */
        stopsLeft: number
        passed: number
        nextStop: string
        alight: string
        arrivalMs: number | null
        remaining: number
      }
    | { kind: 'missed-stop'; alight: string }
  )

/** Within this of the stop counts as there, waiting. */
export const AT_STOP_METERS = 40
/** Still at the stop this long after the planned departure: the vehicle has gone. */
export const MISSED_GRACE_MS = 90_000
/** Closer than this to the alighting stop: get off now. */
export const ALIGHT_NOW_METERS = 150
const BOARDED_METERS = 60
const VEHICLE_SPEED = 4
const STOP_PASSED_METERS = 25
const MISSED_STOP_SEARCH = 1500

const ms = (v?: string | Date) => (v ? new Date(v).getTime() : null)

export const stopKey = (stop: TransitStopInput) => stop.id || stop.name

/** Board, intermediate and alight stops of a transit segment, placed on the route. */
export function rideStops(route: NavRoute, segmentIndex: number, segment: TransitSegmentInput): RideStop[] {
  const span = route.segments[segmentIndex]
  if (!span) return []
  const stops = [segment.departureStop, ...(segment.intermediateStops ?? []), segment.arrivalStop].filter(
    (stop): stop is TransitStopInput => !!stop,
  )
  let from = span.startDistance
  return stops.map((stop, i) => {
    const edge = i === 0 ? span.startDistance : i === stops.length - 1 ? span.endDistance : null
    const s = edge ?? (stop.location ? distanceAlong(route, stop.location, from) : from)
    from = Math.min(span.endDistance, Math.max(from, s))
    return { key: stopKey(stop), name: stop.name, s: from, timeMs: ms(i === 0 ? stop.departureTime ?? segment.startTime : stop.arrivalTime) }
  })
}

export function transitStage(
  route: NavRoute,
  segments: TransitSegmentInput[],
  rides: (RideStop[] | null)[],
  puck: PuckState,
  nowMs: number,
): TransitStage | null {
  const span = segmentAt(route, puck.s)
  if (!span) return null
  const segment = segments[span.index]
  const next = segments[span.index + 1]
  const previous = segments[span.index - 1]

  if (segment?.mode === 'transit') {
    const stops = rides[span.index] ?? []
    const board = stops[0]
    const alight = stops.at(-1)
    if (!board || !alight) return null
    const boarded = puck.s > board.s + BOARDED_METERS
    if (!boarded) return waiting(span.index, segment, puck.s >= span.startDistance - AT_STOP_METERS, nowMs)
    const passed = stops.filter(stop => stop.s <= puck.s + STOP_PASSED_METERS).length
    if (!puck.snapped && alight.s - puck.s < MISSED_STOP_SEARCH) return { segmentIndex: span.index, kind: 'missed-stop', alight: alight.name }
    return {
      segmentIndex: span.index,
      kind: 'riding',
      passed,
      stopsLeft: Math.max(1, stops.length - passed),
      nextStop: stops[Math.min(passed, stops.length - 1)].name,
      alight: alight.name,
      arrivalMs: alight.timeMs,
      remaining: Math.max(0, alight.s - puck.s),
    }
  }

  // Off the route just after getting off, faster than the next mode could go: still on board.
  const sinceAlight = puck.s - span.startDistance
  const stillRiding = !puck.snapped && puck.speed > Math.max(VEHICLE_SPEED, modeProfile(span.mode).baseSpeed * 1.8)
  if (previous?.mode === 'transit' && sinceAlight < MISSED_STOP_SEARCH && stillRiding) {
    return { segmentIndex: span.index - 1, kind: 'missed-stop', alight: previous.arrivalStop?.name ?? '' }
  }

  if (next?.mode === 'transit') {
    return waiting(span.index + 1, next, span.endDistance - puck.s <= AT_STOP_METERS, nowMs)
  }
  return null
}

function waiting(segmentIndex: number, segment: TransitSegmentInput, atStop: boolean, nowMs: number): TransitStage {
  const departureMs = ms(segment.startTime) ?? nowMs
  const stop = segment.departureStop?.name ?? ''
  const kind = nowMs > departureMs + MISSED_GRACE_MS ? 'missed-vehicle' : atStop ? 'wait' : 'to-stop'
  return { segmentIndex, kind, stop, departureMs }
}

export type TransitEvent = 'wait' | 'missed-vehicle' | 'missed-stop' | 'alight-next' | 'alight-now'

/** The stage's own event, which is announced once. */
export function stageEvent(stage: TransitStage): TransitEvent | null {
  switch (stage.kind) {
    case 'wait':
    case 'missed-vehicle':
    case 'missed-stop':
      return stage.kind
    case 'riding':
      if (stage.remaining < ALIGHT_NOW_METERS) return 'alight-now'
      return stage.stopsLeft === 1 ? 'alight-next' : null
    default:
      return null
  }
}

/**
 * Seconds to the leg's end when a ride is still ahead: the vehicle keeps its
 * timetable however fast the rider walks, so the last ride's arrival anchors it.
 */
export function timetabledRemaining(
  route: NavRoute,
  segments: TransitSegmentInput[],
  durations: number[],
  s: number,
  nowMs: number,
): number | null {
  const current = segmentAt(route, s)?.index ?? 0
  let last = -1
  segments.forEach((segment, i) => {
    if (segment.mode === 'transit' && i >= current) last = i
  })
  const arrival = last >= 0 ? ms(segments[last].endTime) : null
  if (arrival == null) return null
  const after = durations.slice(last + 1).reduce((sum, d) => sum + d, 0)
  return Math.max(0, (arrival - nowMs) / 1000) + after
}

const WALK_PACE = 1.3

/** Seconds of walking left to the boarding stop of `stage`. */
export function walkToStopSec(route: NavRoute, stage: TransitStage, s: number): number {
  const board = route.segments[stage.segmentIndex]?.startDistance ?? s
  return Math.max(0, board - s) / WALK_PACE
}

/** A ride has no turns; give it a boarding step so the banner names the stop rather than skipping past. */
export function withBoardingStep<T extends NavSegmentInput & TransitSegmentInput>(segment: T): T {
  const start = segment.geometry?.[0]
  if (segment.mode !== 'transit' || segment.instructions?.length || !start) return segment
  const board = {
    type: 'board',
    text: segment.departureStop?.name ?? '',
    coordinate: { lat: start.lat, lng: start.lng },
    distance: 0,
    duration: 0,
    streetName: segment.departureStop?.name,
  }
  return { ...segment, instructions: [board] }
}
