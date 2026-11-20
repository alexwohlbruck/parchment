/** A planned trip reduced to the path a saved route keeps: geometry, per-leg segments, elevation and totals. */

export interface RoutePathSegment {
  mode: string
  /** [lng, lat] pairs. */
  geometry: Array<[number, number]>
  distance: number
  duration: number
}

export interface RoutePathStats {
  distance: number
  duration: number
  elevationGain?: number
  elevationLoss?: number
}

export interface RoutePath {
  geometry: Array<[number, number]>
  /** Per-vertex elevation aligned to `geometry`, when the engine returned it. */
  elevation?: number[]
  segments: RoutePathSegment[]
  stats: RoutePathStats
}

interface PathPoint {
  lat: number
  lng: number
  elevation?: number
}

interface PathSegment {
  mode: string
  geometry?: PathPoint[] | null
  distance?: number
  duration?: number
  totalElevationGain?: number
  totalElevationLoss?: number
  details?: { multimodalSegments?: PathSegment[] } | null
}

interface PathTrip {
  segments?: PathSegment[]
  tripStats?: { totalDistance?: number; totalDuration?: number }
}

interface CollectedLeg extends RoutePathSegment {
  elevation: Array<number | undefined>
}

/** The leaf legs that carry geometry; multimodal segments nest theirs under `details`. */
export function collectLegs(segments: PathSegment[] | undefined): CollectedLeg[] {
  return (segments ?? []).flatMap((segment): CollectedLeg[] => {
    if (segment.details?.multimodalSegments) return collectLegs(segment.details.multimodalSegments)
    const points = segment.geometry ?? []
    return [{
      mode: segment.mode,
      geometry: points.map(c => [c.lng, c.lat]),
      distance: segment.distance ?? 0,
      duration: segment.duration ?? 0,
      elevation: points.map(c => (typeof c.elevation === 'number' ? c.elevation : undefined)),
    }]
  })
}

export function pathFromTrip(trip: PathTrip): RoutePath {
  const legs = collectLegs(trip.segments)
  const elevation = legs.flatMap(leg => leg.elevation)
  const sum = (field: 'totalElevationGain' | 'totalElevationLoss') =>
    (trip.segments ?? []).reduce((total, segment) => total + (segment[field] ?? 0), 0)
  const elevationGain = sum('totalElevationGain')
  const elevationLoss = sum('totalElevationLoss')
  return {
    geometry: legs.flatMap(leg => leg.geometry),
    elevation: elevation.some(value => value !== undefined) ? elevation.map(value => value ?? 0) : undefined,
    segments: legs.map(({ elevation: _elevation, ...leg }) => leg),
    stats: {
      distance: trip.tripStats?.totalDistance ?? 0,
      duration: trip.tripStats?.totalDuration ?? 0,
      elevationGain: elevationGain || undefined,
      elevationLoss: elevationLoss || undefined,
    },
  }
}
