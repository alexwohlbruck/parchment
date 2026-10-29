import { api } from '@/lib/api'
import type { BoardingCandidates } from '@server/lib/transit/boarding-candidates'
import type { CandidateSet } from '@/lib/guidance/vehicle-switch'
import type { TransitStopInput } from '@/lib/guidance/transit-progress'

export interface CandidateRide {
  startTime?: string | Date
  endTime?: string | Date
  lineName?: string
  routeOptions?: { shortName?: string }[]
  directionId?: string | number | null
  departureStop?: TransitStopInput
  arrivalStop?: TransitStopInput
  intermediateStops?: TransitStopInput[]
}

/** Dev only: stands in for the server so each kind of vehicle switch can be forced. */
let devOverride: ((ride: CandidateRide) => CandidateSet) | null = null
export function setDevCandidateOverride(override: typeof devOverride) {
  if (import.meta.env.DEV) devOverride = override
}

const iso = (v?: string | Date) => (v ? new Date(v).toISOString() : undefined)

/** The runs the rider may board on `ride` in place of the planned one, or null when the ride can't be looked up. */
export async function fetchVehicleCandidates(ride: CandidateRide): Promise<CandidateSet | null> {
  if (devOverride) return devOverride(ride)
  const stops = [...(ride.intermediateStops ?? []), ride.arrivalStop].flatMap(stop => (stop?.id ? [stop.id] : []))
  const departure = iso(ride.startTime)
  const arrival = iso(ride.endTime)
  if (!ride.departureStop?.id || !stops.length || !departure || !arrival) return null
  const routes = new Set([ride.lineName, ...(ride.routeOptions ?? []).map(r => r.shortName)].filter(Boolean))
  try {
    const { data } = await api.get<BoardingCandidates>('/transit/boarding-candidates', {
      params: {
        stopId: ride.departureStop.id,
        stops: stops.join(','),
        departure,
        arrival,
        routes: [...routes].join(','),
        directionId: ride.directionId ?? undefined,
      },
    })
    return {
      known: data.stops,
      candidates: data.candidates.map(c => ({
        tripId: c.tripId,
        line: c.route.shortName || c.route.longName || '',
        color: c.route.color,
        textColor: c.route.textColor,
        routeType: c.route.type,
        headsign: c.headsign,
        departureMs: Date.parse(c.departureTime),
        calls: c.calls.map(call => ({ stop: call.stopId, timeMs: Date.parse(call.time) })),
        position: c.position && { lat: c.position.lat, lng: c.position.lng, atMs: Date.parse(c.position.at) },
      })),
    }
  } catch {
    return null
  }
}
