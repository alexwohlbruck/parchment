import { routingService } from './routing.service'
import type {
  RouteInstruction,
  RouteEdgeSegment,
  Coordinate,
  DrivingSide,
  InstructionLanePlan,
  LaneGeometry,
} from '../types/unified-routing.types'
import type { Language } from '../lib/i18n'
import type { Location } from '../types/valhalla.types'
import { startHeading } from '../lib/start-heading'
import { routeMetrics, type RouteMetrics } from '../lib/route-metrics'

export type RerouteMode = 'walking' | 'cycling' | 'driving'

export const MODE_COSTING: Record<RerouteMode, string> = {
  walking: 'pedestrian',
  cycling: 'bicycle',
  driving: 'auto',
}

export interface RerouteRequest {
  position: { lat: number; lng: number }
  heading?: number
  speed?: number
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
  drivingSide?: DrivingSide
  laneGeometry?: LaneGeometry
  lanePlan?: InstructionLanePlan[]
}

export interface RouteAlternative extends RerouteSegment {
  metrics: RouteMetrics
}

async function segmentRoutes(request: RerouteRequest, alternatives?: number): Promise<RerouteSegment[]> {
  const locations: Location[] = [
    { type: 'coordinates', value: [request.position.lat, request.position.lng] },
    { type: 'coordinates', value: [request.destination.lat, request.destination.lng] },
  ]
  const route = await routingService.getRoute(
    locations,
    MODE_COSTING[request.mode],
    { ...request.routingPreferences, language: request.language },
    { startHeading: startHeading(request, request.mode), alternatives },
  )
  return route.routes
    .map(r => r.legs[0])
    .filter(leg => !!leg)
    .map(leg => ({
      mode: request.mode,
      duration: leg.duration,
      distance: leg.distance,
      geometry: leg.geometry as Coordinate[],
      instructions: leg.instructions ?? [],
      edgeSegments: leg.edgeSegments,
    }))
}

/** A fresh route for the rest of one segment, leaving the way the traveller is heading. */
export async function rerouteSegment(request: RerouteRequest): Promise<RerouteSegment | null> {
  return (await segmentRoutes(request))[0] ?? null
}

const MAX_ALTERNATIVES = 3

/** Every sensible way to finish the segment, each with what it is like. */
export async function alternativeSegments(request: RerouteRequest): Promise<RouteAlternative[]> {
  const routes = await segmentRoutes(request, MAX_ALTERNATIVES)
  return routes.map(segment => ({ ...segment, metrics: routeMetrics(segment) }))
}
