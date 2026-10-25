import { routingService } from './routing.service'
import type { RouteInstruction, RouteEdgeSegment, Coordinate } from '../types/unified-routing.types'
import type { Language } from '../lib/i18n'
import type { Location } from '../types/valhalla.types'

export type RerouteMode = 'walking' | 'cycling' | 'driving'

export const MODE_COSTING: Record<RerouteMode, string> = {
  walking: 'pedestrian',
  cycling: 'bicycle',
  driving: 'auto',
}

export interface RerouteRequest {
  position: { lat: number; lng: number }
  heading?: number
  destination: { lat: number; lng: number }
  mode: RerouteMode
  routingPreferences?: Record<string, unknown>
  language?: Language
}

export interface RerouteSegment {
  mode: RerouteMode
  hazards?: import('../types/unified-routing.types').RouteHazard[]
  duration: number
  distance: number
  geometry: Coordinate[]
  instructions: RouteInstruction[]
  edgeSegments?: RouteEdgeSegment[]
}

/** A fresh route for the rest of one segment, leaving the way the traveller is heading. */
export async function rerouteSegment(request: RerouteRequest): Promise<RerouteSegment | null> {
  const locations: Location[] = [
    { type: 'coordinates', value: [request.position.lat, request.position.lng] },
    { type: 'coordinates', value: [request.destination.lat, request.destination.lng] },
  ]
  const route = await routingService.getRoute(
    locations,
    MODE_COSTING[request.mode],
    { ...request.routingPreferences, language: request.language },
    { startHeading: request.heading },
  )
  const leg = route.routes[0]?.legs[0]
  if (!leg) return null
  return {
    mode: request.mode,
    duration: leg.duration,
    distance: leg.distance,
    geometry: leg.geometry as Coordinate[],
    instructions: leg.instructions ?? [],
    edgeSegments: leg.edgeSegments,
  }
}
