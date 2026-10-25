import { api } from '@/lib/api'
import type { LngLat } from '@/types/map.types'
import type { RouteEdgeSegment, RouteInstruction } from '@/types/directions.types'
import type { RouteMetrics } from '@/lib/guidance/alternatives'
import type { TripOption } from '@/types/directions.types'
import { mapCandidate } from '@/lib/directions/trip-response'

export interface RerouteSegment {
  mode: string
  duration: number
  distance: number
  geometry: LngLat[]
  instructions: RouteInstruction[]
  edgeSegments?: RouteEdgeSegment[]
}

const SERVER_MODES: Record<string, 'walking' | 'cycling' | 'driving'> = {
  walking: 'walking',
  cycling: 'cycling',
  biking: 'cycling',
  driving: 'driving',
}

export function canReroute(mode: string): boolean {
  return mode in SERVER_MODES
}

export async function requestReroute(params: {
  position: LngLat
  heading: number | null
  destination: LngLat
  mode: string
}): Promise<RerouteSegment | null> {
  const { data } = await api.post('/directions/reroute', {
    position: params.position,
    heading: params.heading ?? undefined,
    destination: params.destination,
    mode: SERVER_MODES[params.mode],
  })
  return data?.segment ?? null
}

export interface AlternativeSegment extends RerouteSegment {
  metrics: RouteMetrics
}

export async function requestAlternatives(params: {
  position: LngLat
  heading: number | null
  destination: LngLat
  mode: string
}): Promise<AlternativeSegment[]> {
  const { data } = await api.post('/directions/alternatives', {
    position: params.position,
    heading: params.heading ?? undefined,
    destination: params.destination,
    mode: SERVER_MODES[params.mode],
  })
  return data?.alternatives ?? []
}

/** Transit plans from here to `destination`, leaving at `departAt`, with no personal vehicles. */
export async function requestTransitItineraries(params: { position: LngLat; destination: LngLat; departAt: Date }): Promise<TripOption[]> {
  const { data } = await api.post('/directions/', {
    waypoints: [
      { location: params.position, type: 'origin' },
      { location: params.destination, type: 'destination' },
    ],
    selectedMode: 'transit',
    availableVehicles: [],
    preferredDepartureTime: params.departAt.toISOString(),
  })
  return (data?.trips ?? []).map((candidate: unknown, i: number) => mapCandidate(candidate, i))
}
