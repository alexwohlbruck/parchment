// Stand-in boarding candidates that force each kind of vehicle switch.

import { stopKey, type TransitStopInput } from '@/lib/guidance/transit-progress'
import type { CandidateSet, VehicleCandidate } from '@/lib/guidance/vehicle-switch'
import type { CandidateRide } from '@/services/guidance/vehicle-candidates.service'

export type VehicleScenario = 'earlier' | 'later' | 'interchangeable' | 'ambiguous'

/** Where the planned departure is put relative to the moment the rider reaches the stop. */
export const PLANNED_FROM_ARRIVAL_MS: Record<VehicleScenario, number> = {
  earlier: 6 * 60_000,
  later: -3 * 60_000,
  interchangeable: 4 * 60_000,
  ambiguous: 10_000,
}

const BOARD_SOON_MS = 15_000
const EXPRESS_PACE = 0.85

type Ride = CandidateRide & { tripId?: string; lineColor?: string | null; lineTextColor?: string; headsign?: string; routeType?: number }

const toMs = (v?: string | Date) => (v ? new Date(v).getTime() : NaN)

function runOf(ride: Ride, tripId: string, departureMs: number, overrides: Partial<VehicleCandidate> = {}, express = false): VehicleCandidate {
  const plannedMs = toMs(ride.startTime)
  const stops = [...(ride.intermediateStops ?? []), ride.arrivalStop].filter((s): s is TransitStopInput => !!s)
  const calls = stops.flatMap((stop, i) => {
    const plannedAt = toMs(stop.arrivalTime ?? (stop === ride.arrivalStop ? ride.endTime : undefined))
    if (!Number.isFinite(plannedAt) || (express && i % 2 === 1 && stop !== ride.arrivalStop)) return []
    return [{ stop: stopKey(stop), timeMs: departureMs + (plannedAt - plannedMs) * (express ? EXPRESS_PACE : 1) }]
  })
  return {
    tripId,
    line: ride.lineName ?? '',
    color: ride.lineColor ?? undefined,
    textColor: ride.lineTextColor,
    routeType: ride.routeType,
    headsign: ride.headsign,
    departureMs,
    calls,
    ...overrides,
  }
}

function otherLine(ride: Ride): Partial<VehicleCandidate> {
  const name = ride.routeOptions?.map(r => r.shortName).find(n => n && n !== ride.lineName) ?? `${ride.lineName ?? ''}X`
  return { line: name, color: '7C3AED', textColor: 'FFFFFF' }
}

/** The candidates `scenario` stands for, with `nowMs` the moment the rider reached the stop. */
export function scenarioCandidates(scenario: VehicleScenario, ride: Ride, nowMs: number): CandidateSet {
  const planned = toMs(ride.startTime)
  const own = ride.tripId ?? 'planned'
  const known = [...(ride.intermediateStops ?? []), ride.arrivalStop].filter((s): s is TransitStopInput => !!s).map(stopKey)
  const soon = nowMs + BOARD_SOON_MS
  const candidates = {
    earlier: [runOf(ride, 'dev-earlier', soon), runOf(ride, own, planned)],
    later: [runOf(ride, own, planned), runOf(ride, 'dev-later', soon), runOf(ride, 'dev-after', nowMs + 8 * 60_000)],
    interchangeable: [runOf(ride, 'dev-other-line', soon, otherLine(ride)), runOf(ride, own, planned)],
    ambiguous: [runOf(ride, own, planned, {}, true), runOf(ride, 'dev-other-line', planned + 30_000, otherLine(ride))],
  }[scenario]
  return { candidates, known }
}
