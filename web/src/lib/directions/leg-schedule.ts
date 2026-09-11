import type { TripOption } from '@/types/directions.types'
import type { WaypointTimeConstraint } from '@/types/map.types'

/**
 * The smallest gap between arriving somewhere and leaving again.
 *
 * Legs must not overlap, and a leg that departs the very instant the one
 * before it lands reads as a rounding error rather than a plan. One minute
 * is the floor and also the default gap.
 */
export const MIN_LEG_GAP_MS = 60_000

export interface StopWindow {
  /** Earliest this stop can be left. Null when there is no plan to measure. */
  earliest: Date | null
  /** Latest, imposed by an instruction on a stop further along. */
  latest: Date | null
  /** When the plan currently reaches this stop. */
  arrivesAt: Date | null
}

/** How long each leg takes, indexed by leg. */
function legDurations(trip: TripOption | undefined): number[] {
  if (!trip) return []

  const spans: { start: number; end: number }[] = []
  for (const segment of trip.segments) {
    const leg = segment.legIndex ?? 0
    const start = new Date(segment.startTime).getTime()
    const end = new Date(segment.endTime).getTime()
    const span = spans[leg]
    spans[leg] = span
      ? { start: Math.min(span.start, start), end: Math.max(span.end, end) }
      : { start, end }
  }
  return spans.map((span) => (span ? span.end - span.start : 0))
}

const timeOf = (constraint: WaypointTimeConstraint | null | undefined) =>
  constraint?.time ? new Date(constraint.time).getTime() : null

const dwellOf = (constraint: WaypointTimeConstraint | null | undefined) =>
  (constraint?.dwellTime ?? 0) * 60_000

/**
 * When each stop can be left, given the plan and the instructions already set.
 *
 * Walks the trip forward: you cannot leave a stop before you have arrived at
 * it, and you cannot arrive before you have left the one before and travelled.
 * An instruction on a later stop reaches back the other way — leaving too late
 * for it is as impossible as leaving too early for this one.
 */
export function stopWindows(
  trip: TripOption | undefined,
  constraints: (WaypointTimeConstraint | null | undefined)[],
): StopWindow[] {
  const count = constraints.length
  const empty = (): StopWindow => ({ earliest: null, latest: null, arrivesAt: null })
  if (!trip?.segments.length) return Array.from({ length: count }, empty)

  const legs = legDurations(trip)
  const start = new Date(trip.startTime).getTime()

  // ── Forward: the earliest each stop can be reached and left ──────
  const arrival: number[] = new Array(count).fill(NaN)
  const earliest: number[] = new Array(count).fill(NaN)
  let cursor = start

  for (let i = 0; i < count; i++) {
    if (i === 0) {
      arrival[i] = start
      earliest[i] = start
    } else {
      arrival[i] = cursor + (legs[i - 1] ?? 0)
      earliest[i] = arrival[i] + MIN_LEG_GAP_MS
    }
    const asked = timeOf(constraints[i])
    cursor = Math.max(earliest[i], asked ?? earliest[i]) + dwellOf(constraints[i])
  }

  // ── Backward: how late a stop can be left and still make a deadline
  //     further along. Only "arrive by" is a deadline — asking to leave a
  //     later stop after some time says nothing about this one, since the
  //     rider can simply wait there. ──────────────────────────────────
  const latest: (number | null)[] = new Array(count).fill(null)
  let arriveBy: number | null = null

  for (let i = count - 1; i >= 0; i--) {
    const asked = constraints[i]?.mode === 'arriveBy' ? timeOf(constraints[i]) : null
    let arriveHereBy = asked

    if (arriveBy !== null && i < count - 1) {
      const departBy = arriveBy - (legs[i] ?? 0)
      // Arriving, waiting out the gap and any stay, then leaving by then.
      const cap = departBy - MIN_LEG_GAP_MS - dwellOf(constraints[i])
      // "Arrive by" is answered on arrival, so it is the arrival that has to
      // leave room for the stay; "leave after" only has to clear the leg.
      latest[i] = constraints[i]?.mode === 'arriveBy' ? cap : departBy
      arriveHereBy = arriveHereBy === null ? cap : Math.min(arriveHereBy, cap)
    }

    arriveBy = arriveHereBy
  }

  return constraints.map((_, i) => ({
    arrivesAt: Number.isNaN(arrival[i]) ? null : new Date(arrival[i]),
    earliest: Number.isNaN(earliest[i]) ? null : new Date(earliest[i]),
    latest: latest[i] === null ? null : new Date(latest[i]!),
  }))
}

/**
 * Move whatever a new instruction has made impossible.
 *
 * Setting a stop later can strand the ones after it in the past, so each is
 * pushed just far enough to stay reachable. Stops already late enough are
 * left exactly as the rider set them, and one with no instruction stays
 * free — it will simply be planned around the change.
 */
export function cascadeConstraints(
  trip: TripOption | undefined,
  constraints: (WaypointTimeConstraint | null | undefined)[],
  changedIndex: number,
): (WaypointTimeConstraint | null)[] {
  const next = constraints.map((c) => c ?? null)

  for (let i = changedIndex + 1; i < next.length; i++) {
    const constraint = next[i]
    if (!constraint?.time) continue

    const floor = stopWindows(trip, next)[i].earliest
    if (!floor) break
    if (new Date(constraint.time).getTime() >= floor.getTime()) continue

    next[i] = { ...constraint, time: floor.toISOString() }
  }

  return next
}
