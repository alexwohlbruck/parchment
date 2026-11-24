import { api } from '@/lib/api'
import type { LngLat } from '@/types/map.types'
import type { RouteEdgeSegment, RouteInstruction } from '@/types/directions.types'
import type { RouteMetrics } from '@/lib/guidance/alternatives'
import type { TripOption } from '@/types/directions.types'
import { mapCandidate } from '@/lib/directions/trip-response'
import { withCuratedTripColors } from '@/services/layers/features/portolan/portolan-bullets'
import { getNetworkErrorKind, isRetriableNetworkError } from '@/lib/network-errors'
import { planOffline } from '@/services/offline/offline-engine.service'

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
  speed?: number | null
  destination: LngLat
  mode: string
}): Promise<RerouteSegment | null> {
  try {
    const { data } = await api.post('/directions/reroute', {
      position: params.position,
      heading: params.heading ?? undefined,
      speed: params.speed ?? undefined,
      destination: params.destination,
      mode: SERVER_MODES[params.mode],
    })
    return data?.segment ?? null
  } catch (error) {
    if (!isRetriableNetworkError(getNetworkErrorKind(error))) throw error
    return (await rerouteFromSavedAreas(params)) ?? Promise.reject(error)
  }
}

async function rerouteFromSavedAreas(params: { position: LngLat; destination: LngLat; mode: string }): Promise<RerouteSegment | null> {
  const mode = SERVER_MODES[params.mode]
  if (mode === 'driving') return null
  const response = await planOffline({
    origin: params.position,
    destination: params.destination,
    selectedMode: mode === 'cycling' ? 'biking' : 'walking',
    departAfter: Date.now(),
  })
  const segment = response?.trips[0]?.trip.segments[0]
  if (!segment) return null
  const { duration, distance, geometry, instructions } = segment
  return { mode: params.mode, duration, distance, geometry, instructions }
}

export interface AlternativeSegment extends RerouteSegment {
  metrics: RouteMetrics
}

export async function requestAlternatives(params: {
  position: LngLat
  heading: number | null
  speed?: number | null
  destination: LngLat
  mode: string
}): Promise<AlternativeSegment[]> {
  const { data } = await api.post('/directions/alternatives', {
    position: params.position,
    heading: params.heading ?? undefined,
    speed: params.speed ?? undefined,
    destination: params.destination,
    mode: SERVER_MODES[params.mode],
  })
  return data?.alternatives ?? []
}

interface TransitItineraryRequest {
  position: LngLat
  destination: LngLat
  departAt: Date
}

/** Dev only: stands in for the planner so each kind of missed-boarding recovery can be forced. */
let devItineraries: ((params: TransitItineraryRequest) => TripOption[]) | null = null
export function setDevItineraryOverride(override: typeof devItineraries) {
  if (import.meta.env.DEV) devItineraries = override
}

/** Transit plans from here to `destination`, leaving at `departAt`, with no personal vehicles. */
export async function requestTransitItineraries(params: TransitItineraryRequest): Promise<TripOption[]> {
  if (devItineraries) return devItineraries(params)
  const { data } = await api.post('/directions/', {
    waypoints: [
      { location: params.position, type: 'origin' },
      { location: params.destination, type: 'destination' },
    ],
    selectedMode: 'transit',
    availableVehicles: [],
    preferredDepartureTime: params.departAt.toISOString(),
  })
  return withCuratedTripColors<TripOption>((data?.trips ?? []).map((candidate: unknown, i: number) => mapCandidate(candidate, i)))
}
