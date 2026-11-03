import { searchAlongRoute } from './search.service'
import { routingService } from './routing.service'
import { MODE_COSTING, type RerouteMode } from './reroute.service'
import { cumulativeDistances, pointAlong, projectAlong, type LatLng } from '../lib/route-projection'
import type { Location } from '../types/valhalla.types'
import type { Place } from '../types/place.types'

const BUFFER_METERS: Record<RerouteMode, number> = { walking: 250, cycling: 500, driving: 2000 }
/** How far past the place's entry point the detour rejoins the route. */
const REJOIN_AHEAD_METERS: Record<RerouteMode, number> = { walking: 100, cycling: 200, driving: 400 }

export interface AlongRouteRequest {
  /** The route still ahead, starting where the traveller is. */
  route: LatLng[]
  mode: RerouteMode
  query?: string
  categories?: string[]
  limit?: number
}

export interface AlongRouteResult {
  place: Place
  /** Metres ahead along the route to where the place is closest. */
  alongDistance: number
  /** Extra seconds the stop adds over staying on the route, when it could be routed. */
  detourSeconds: number | null
}

export interface AlongRouteDeps {
  search: typeof searchAlongRoute
  duration: (points: LatLng[], mode: RerouteMode) => Promise<number | null>
}

async function routeDuration(points: LatLng[], mode: RerouteMode): Promise<number | null> {
  const locations: Location[] = points.map(p => ({ type: 'coordinates', value: [p.lat, p.lng] }))
  try {
    const route = await routingService.getRoute(locations, MODE_COSTING[mode])
    return route.routes[0]?.summary.totalDuration ?? null
  } catch {
    return null
  }
}

export async function searchAlongNavRoute(
  request: AlongRouteRequest,
  deps: AlongRouteDeps = { search: searchAlongRoute, duration: routeDuration },
): Promise<AlongRouteResult[]> {
  const { route, mode } = request
  if (route.length < 2) return []
  const limit = request.limit ?? 10
  const buffer = BUFFER_METERS[mode]
  // Free-text matches are not confined to the corridor upstream, so ask for spares and trim here.
  const places = await deps.search(
    { type: 'LineString', coordinates: route.map(p => [p.lng, p.lat]) },
    { query: request.query, categories: request.categories, buffer, limit: limit * 3 },
  )
  const cumulative = cumulativeDistances(route)
  const ahead = places
    .map(place => ({ place, center: place.geometry?.value?.center }))
    .filter((r): r is { place: Place; center: LatLng } => !!r.center)
    .map(r => ({ ...r, ...projectAlong(route, r.center, cumulative) }))
    .filter(r => r.along > 0 && r.offset <= buffer)
    .slice(0, limit)
    .map(({ place, center, along }) => ({ place, center, alongDistance: along }))

  const results = await Promise.all(
    ahead.map(async ({ place, center, alongDistance }) => {
      const entry = pointAlong(route, alongDistance, cumulative)
      const rejoin = pointAlong(route, alongDistance + REJOIN_AHEAD_METERS[mode], cumulative)
      const [via, direct] = await Promise.all([
        deps.duration([entry, center, rejoin], mode),
        deps.duration([entry, rejoin], mode),
      ])
      const detourSeconds = via != null && direct != null ? Math.max(0, via - direct) : null
      return { place, alongDistance, detourSeconds }
    }),
  )
  return results.sort((a, b) => a.alongDistance - b.alongDistance)
}
