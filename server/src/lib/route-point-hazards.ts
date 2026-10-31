// Barrelman's /route/hazards for a segment: the request, and its answer judged
// against when and where the trip happens. Pure; the call is routingService.getHazards.

import { getPosition } from 'suncalc'
import { isPremiumHazard } from './route-hazards'
import { segmentCountry } from './route-lanes'
import type { WeatherOutlook } from '../types/integration.types'
import type {
  Coordinate,
  PointHazardsProfile,
  RouteEdgeSegment,
  RouteHazard,
  RouteHazardKind,
  RoutePointHazard,
  RoutePointHazardsRequest,
} from '../types/unified-routing.types'

export interface PointHazardSegment {
  mode: string
  geometry?: Coordinate[] | null
  edgeSegments?: RouteEdgeSegment[]
  distance?: number
}

export interface HazardConditions {
  /** When the segment starts; a hazard's time is read off its distance along it. */
  start: Date
  /** Seconds the segment takes. */
  duration?: number
  outlook: WeatherOutlook | null
}

const PROFILES: Record<string, PointHazardsProfile> = { driving: 'car', biking: 'bike', cycling: 'bike', walking: 'foot' }
/** Barrelman's own limit on a route's length. */
const MAX_ROUTE_METERS = 300_000
/** Freezing on a bridge deck before the road: decks lose heat from below. */
export const ICY_BRIDGE_CELSIUS = 2
const LOW_CLEARANCE_METERS = 3
/** The sun's centre this far below the horizon is sunset, refraction included. */
const SUNSET_ALTITUDE = (-0.833 * Math.PI) / 180

/** Where warning of speed cameras is lawful, as ISO 3166-1 alpha-3. Anywhere else, or unknown, they stay hidden. */
const CAMERA_COUNTRIES = new Set([
  'USA', 'CAN', 'MEX', 'BRA', 'GBR', 'IRL', 'NLD', 'ESP', 'ITA', 'PRT', 'SWE', 'NOR', 'DNK', 'FIN', 'POL', 'CZE', 'AUS', 'NZL', 'ZAF',
])

const SEVERITY: Partial<Record<RouteHazardKind, RouteHazard['severity']>> = {
  traffic_signals: 'low',
  stop: 'medium',
  give_way: 'low',
  tram_tracks: 'high',
  tram_crossing: 'high',
  unlit: 'medium',
  flood_prone: 'high',
  school_zone: 'medium',
  traffic_calming: 'low',
  no_sidewalk: 'medium',
  low_clearance: 'high',
  toll: 'low',
  speed_camera: 'low',
  movable_bridge: 'low',
  hazard: 'medium',
}

const BUSY_ROADS = new Set(['trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link'])

export function pointHazardsProfile(mode: string): PointHazardsProfile | undefined {
  return PROFILES[mode]
}

export function pointHazardsRequest(segment: PointHazardSegment): RoutePointHazardsRequest | null {
  const profile = pointHazardsProfile(segment.mode)
  const geometry = segment.geometry ?? []
  if (!profile || geometry.length < 2 || (segment.distance ?? 0) > MAX_ROUTE_METERS) return null
  return { profile, coordinates: geometry.map(c => [c.lng, c.lat]) }
}

/** Flood-prone stretches wait on the forecast, and so do bridges for a frost. */
export function needsOutlook(segment: PointHazardSegment, found: RoutePointHazard[] | null): boolean {
  if (found?.some(h => h.kind === 'flood_prone')) return true
  return segment.mode !== 'walking' && (segment.edgeSegments ?? []).some(e => e.roadEnvironment === 'bridge')
}

export function isFreezing(outlook: WeatherOutlook | null): boolean {
  return outlook != null && outlook.minTemperature <= ICY_BRIDGE_CELSIUS
}

export function sunIsDown(at: Coordinate, time: Date): boolean {
  return getPosition(time, at.lat, at.lng).altitude < SUNSET_ALTITUDE
}

function timeAt(distance: number, segment: PointHazardSegment, conditions: HazardConditions): Date {
  const length = segment.distance ?? 0
  const share = length > 0 ? Math.min(1, distance / length) : 0
  return new Date(conditions.start.getTime() + share * (conditions.duration ?? 0) * 1000)
}

function severity(kind: RouteHazardKind, detail: string | undefined): RouteHazard['severity'] {
  if (kind === 'no_sidewalk' && detail && BUSY_ROADS.has(detail)) return 'high'
  if (kind === 'stop' && detail === 'all') return 'low'
  return SEVERITY[kind] ?? 'medium'
}

/** Barrelman's hazards as the segment's, kept only where they matter now and here. */
export function pointHazards(
  found: RoutePointHazard[],
  segment: PointHazardSegment,
  conditions: HazardConditions,
): RouteHazard[] {
  const country = segmentCountry(segment.edgeSegments)
  const relevant = (h: RoutePointHazard, coordinate: Coordinate) => {
    switch (h.kind) {
      case 'unlit':
        return sunIsDown(coordinate, timeAt(h.distance, segment, conditions))
      case 'flood_prone':
        return conditions.outlook?.rain === true
      case 'speed_camera':
        return country != null && CAMERA_COUNTRIES.has(country.toUpperCase())
      case 'low_clearance':
        return Number(h.detail) <= LOW_CLEARANCE_METERS
      default:
        return h.kind in SEVERITY
    }
  }
  const out: RouteHazard[] = []
  for (const h of found) {
    const kind = h.kind as RouteHazardKind
    const coordinate = { lat: h.coordinate[1], lng: h.coordinate[0] }
    if (!relevant(h, coordinate)) continue
    out.push({
      kind,
      severity: severity(kind, h.detail),
      startDistance: h.distance,
      ...(h.endDistance != null && { endDistance: h.endDistance }),
      coordinate,
      ...(h.detail && { variant: h.detail }),
      ...(isPremiumHazard(kind) && { premium: true }),
    })
  }
  return out
}
