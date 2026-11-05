/** How a transit trip's arrival moves with the leave time, read off its legs' departure boards. */

import type { TripSegment } from '../../types/trip.types'
import type { DepartureProfile, DepartureRun } from '../../types/departure-profile.types'
import { boardCompleteUntil, type StopBoard } from '../transit/route-options'

/** A stop's departures, complete for `[fromMs, untilMs]`. */
export interface CoveredBoard {
  departures: NonNullable<StopBoard['departures']>
  fromMs: number
  untilMs: number
}

/** Merges a stop's boards into one, complete up to where the first cut-short board ends. */
export function coverBoards(
  boards: StopBoard[],
  window: { fromMs: number; untilMs: number },
  cap: number,
): CoveredBoard {
  const untilMs = Math.min(window.untilMs, ...boards.map((b) => boardCompleteUntil(b, window.untilMs, cap)))
  return { departures: boards.flatMap((b) => b.departures ?? []), fromMs: window.fromMs, untilMs }
}

/** One transfer of the planned run: its slack, and what missing it costs. */
export interface TransferRisk {
  slackSec: number
  /** Arrival on the next run at that stop minus the planned arrival. A lower bound when the boards end first. */
  missDelaySec: number
}

export interface TripTiming {
  profile: DepartureProfile
  plannedTransfers: TransferRisk[]
}

/** Leave times covered after the planned departure. */
export const PROFILE_SPAN_MS = 35 * 60_000
/** Earlier runs offered ahead of the planned one. */
const MAX_EARLIER_RUNS = 3
/** How far a board time may sit from the planned one and still be the same run. */
const SAME_RUN_MS = 60_000
/** A run whose leave time is this far behind the request is already gone. */
const LEAVE_GRACE_MS = 60_000

interface Leg {
  stopId?: string
  stopName: string
  routes: Set<string>
  directionId?: string
  tripId?: string
  departMs: number
  rideMs: number
  /** Moving time from the previous leg's alighting, or from the origin. */
  leadMs: number
}

interface Run {
  atMs: number
  live: boolean
  tripId?: string
}

interface Chain {
  arriveMs: number
  live: boolean
  minSlackMs?: number
  tightestAt?: string
}

const movingMs = (s: TripSegment) => Math.max(0, (s.duration - (s.waitSeconds ?? 0)) * 1000)

export interface TripLegs {
  legs: Leg[]
  egressMs: number
}

/** The transit legs and the street time around them, or null when a leg lacks what a board lookup needs. */
export function readTripLegs(segments: TripSegment[]): TripLegs | null {
  const legs: Leg[] = []
  let leadMs = 0
  let prevEndMs = NaN
  for (const s of segments) {
    if (s.mode !== 'transit') {
      // A gap between street legs is parking or docking, not waiting.
      const gapMs = Date.parse(s.startTime) - prevEndMs
      if (gapMs > 0) leadMs += gapMs
      leadMs += movingMs(s)
      prevEndMs = Date.parse(s.endTime)
      continue
    }
    const td = s.details?.transitDetails
    if (!td) return null
    const departMs = Date.parse(td.departureStop?.departureTime ?? s.startTime)
    const arriveMs = Date.parse(td.arrivalStop?.arrivalTime ?? s.endTime)
    const routes = new Set(
      [td.route?.shortName, ...(td.routeOptions ?? []).map((r) => r.shortName)]
        .filter((n): n is string => !!n),
    )
    if (Number.isNaN(departMs) || Number.isNaN(arriveMs) || routes.size === 0) return null
    legs.push({
      stopId: td.departureStop?.id,
      stopName: td.departureStop?.name ?? '',
      routes,
      directionId: td.directionId != null ? String(td.directionId) : undefined,
      tripId: td.trip?.id,
      departMs,
      rideMs: Math.max(0, arriveMs - departMs),
      leadMs,
    })
    leadMs = 0
    prevEndMs = arriveMs
  }
  return legs.length ? { legs, egressMs: leadMs } : null
}

/** Runs of the leg's lines in its direction. Lines leaving together are one chance to board. */
function matchingRuns(leg: Leg, board: CoveredBoard): Run[] {
  const seen = new Set<number>()
  const runs: Run[] = []
  for (const d of board.departures) {
    if (d.cancelled || !d.route?.shortName || !leg.routes.has(d.route.shortName)) continue
    if (leg.directionId != null && d.directionId != null && String(d.directionId) !== leg.directionId) continue
    const atMs = Date.parse(d.departureTime ?? '')
    if (Number.isNaN(atMs) || atMs > board.untilMs) continue
    if (seen.has(atMs)) continue
    seen.add(atMs)
    runs.push({ atMs, live: d.realTime === true, tripId: d.tripId })
  }
  return runs.sort((a, b) => a.atMs - b.atMs)
}

/** The board's record of the run the trip itself rides. */
function ownRunIndex(leg: Leg, runs: Run[]): number {
  if (leg.tripId) {
    const byTrip = runs.findIndex((r) => r.tripId === leg.tripId)
    if (byTrip >= 0) return byTrip
  }
  let best = -1
  for (let i = 0; i < runs.length; i++) {
    const gap = Math.abs(runs[i].atMs - leg.departMs)
    if (gap <= SAME_RUN_MS && (best < 0 || gap < Math.abs(runs[best].atMs - leg.departMs))) best = i
  }
  return best
}

/**
 * Builds the profile, or null when a board is missing or does not show the
 * trip's own runs. `boards` holds one board per transit leg, in order.
 */
export function buildTripTiming(
  { legs, egressMs }: TripLegs,
  boards: Array<CoveredBoard | null>,
  { notBeforeMs, arriveByMs = Infinity }: { notBeforeMs: number; arriveByMs?: number },
): TripTiming | null {
  if (boards.length !== legs.length || boards.some((b) => !b)) return null

  const runs = legs.map((leg, i) => matchingRuns(leg, boards[i]!))
  const own = legs.map((leg, i) => ownRunIndex(leg, runs[i]))
  if (own.some((i) => i < 0)) return null

  /** Rides on from boarding leg `from` at `atMs`; null where a board ends first. */
  const rideOn = (from: number, atMs: number, live: boolean): Chain | null => {
    let arriveMs = atMs + legs[from].rideMs
    const chain: Chain = { arriveMs, live }
    for (let i = from + 1; i < legs.length; i++) {
      const reachMs = arriveMs + legs[i].leadMs
      if (reachMs < boards[i]!.fromMs) return null
      const next = runs[i].find((r) => r.atMs >= reachMs)
      if (!next) return null
      const slackMs = next.atMs - reachMs
      if (chain.minSlackMs == null || slackMs < chain.minSlackMs) {
        chain.minSlackMs = slackMs
        chain.tightestAt = legs[i].stopName
      }
      chain.live &&= next.live
      arriveMs = next.atMs + legs[i].rideMs
    }
    chain.arriveMs = arriveMs + egressMs
    return chain
  }

  const plannedChain = plannedRun(legs, egressMs, own.map((idx, i) => runs[i][idx].live))
  const toRun = (departMs: number, chain: Chain): DepartureRun => ({
    leaveBy: new Date(departMs - legs[0].leadMs).toISOString(),
    departAt: new Date(departMs).toISOString(),
    arriveAt: new Date(chain.arriveMs).toISOString(),
    ...(chain.minSlackMs != null && {
      minTransferSlackSec: Math.round(chain.minSlackMs / 1000),
      tightestTransferAt: chain.tightestAt,
    }),
    live: chain.live,
  })

  const plannedMs = legs[0].departMs
  const others = runs[0].filter((_, j) => j !== own[0])
  const earlierRuns = others.filter((r) => r.atMs < plannedMs)
  const earlier: DepartureRun[] = []
  for (let j = earlierRuns.length - 1; j >= 0 && earlier.length < MAX_EARLIER_RUNS; j--) {
    const run = earlierRuns[j]
    if (run.atMs - legs[0].leadMs < notBeforeMs - LEAVE_GRACE_MS) break
    const chain = rideOn(0, run.atMs, run.live)
    if (!chain) break
    earlier.unshift(toRun(run.atMs, chain))
  }

  const later: DepartureRun[] = []
  for (const run of others.filter((r) => r.atMs > plannedMs)) {
    if (run.atMs > plannedMs + PROFILE_SPAN_MS) break
    const chain = rideOn(0, run.atMs, run.live)
    if (!chain || chain.arriveMs > arriveByMs) break
    later.push(toRun(run.atMs, chain))
  }

  const profileRuns = [...earlier, toRun(legs[0].departMs, plannedChain), ...later]
  const plannedTransfers = legs.slice(1).map((leg, k): TransferRisk => {
    const i = k + 1
    const reachMs = legs[k].departMs + legs[k].rideMs + leg.leadMs
    const ownAt = runs[i][own[i]].atMs
    const next = runs[i].find((r) => r.atMs > ownAt)
    const missed = next ? rideOn(i, next.atMs, next.live) : null
    const delayMs = missed
      ? missed.arriveMs - plannedChain.arriveMs
      : (next?.atMs ?? boards[i]!.untilMs) - ownAt
    return {
      slackSec: Math.round((leg.departMs - reachMs) / 1000),
      missDelaySec: Math.max(0, Math.round(delayMs / 1000)),
    }
  })

  return {
    profile: {
      runs: profileRuns,
      plannedRunIndex: earlier.length,
      validUntil: profileRuns[profileRuns.length - 1].leaveBy,
    },
    plannedTransfers,
  }
}

/** The trip as planned, timed from its own legs so it matches what the rider is shown. */
function plannedRun(legs: Leg[], egressMs: number, live: boolean[]): Chain {
  const chain: Chain = { arriveMs: 0, live: live.every(Boolean) }
  for (let i = 1; i < legs.length; i++) {
    const slackMs = legs[i].departMs - (legs[i - 1].departMs + legs[i - 1].rideMs + legs[i].leadMs)
    if (chain.minSlackMs == null || slackMs < chain.minSlackMs) {
      chain.minSlackMs = slackMs
      chain.tightestAt = legs[i].stopName
    }
  }
  const last = legs[legs.length - 1]
  chain.arriveMs = last.departMs + last.rideMs + egressMs
  return chain
}
