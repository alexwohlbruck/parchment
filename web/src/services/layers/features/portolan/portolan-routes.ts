/**
 * Portolan route ids, translated into the pair the rest of the app is
 * keyed by.
 *
 * A bullet riding a ribbon knows its route the way the pyramid knows it:
 * the feed's own GTFS `route_id`, prefixed when a group build merges
 * several feeds ("f3:2"). The route detail is keyed by (feedId, routeId),
 * and a bare id cannot supply the first half — "2" is the IRT Seventh
 * Avenue line here and the Long Island Rail Road's Ronkonkoma branch
 * twenty miles east, and the tiles never name either feed.
 *
 * Barrelman answers it from the one thing the tap does supply: WHERE.
 * /transit/resolve-route takes the bare id, the bullet's own coordinate
 * and its mode class, and returns the feed whose stops are nearest.
 *
 * The answer is cached per pyramid + tile id, not per point: every bullet
 * of one route in one pyramid is the same route, so the second tap on a
 * line is a navigation with nothing in front of it.
 */
import { api } from '@/lib/api'

export interface PortolanRouteRef {
  /** The feed's own GTFS route id, with any group prefix stripped. */
  routeId: string
  /** Portolan mode class — narrows a shared id to routes of its kind. */
  mode?: string
  lat: number
  lng: number
  /** Cache identity: same pyramid + same tile id is the same route. */
  key: string
}

export interface ResolvedTransitRoute {
  feedId: string
  routeId: string
}

/**
 * A group pyramid prefixes every feed after the first, so the 2 is `f3:2`
 * there and plain `2` alone. Only that exact shape is a prefix: a route id
 * with a colon of its own ("SEPTA:BSL") keeps every character.
 */
export function bareRouteId(token: string): string {
  const m = /^f\d+:(.+)$/.exec(token)
  return m ? m[1] : token
}

/** What a clicked caterpillar bullet identifies, or null when the feature
 *  carries no route at all (an older tile, a stray symbol). */
export function routeRefFor(props: any, coords: unknown): PortolanRouteRef | null {
  const token = String(props?.route ?? '')
  if (!token) return null
  const point = Array.isArray(coords) ? coords : null
  const lng = Number(point?.[0])
  const lat = Number(point?.[1])
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  const mode = props?.mode ? String(props.mode) : undefined
  return {
    routeId: bareRouteId(token),
    mode,
    lat,
    lng,
    key: `${props?._feed ?? ''}|${token}`,
  }
}

const resolved = new Map<string, Promise<ResolvedTransitRoute | null>>()

/**
 * The (feedId, routeId) pair for a bullet, or null when nothing in the
 * timetable database claims that id near that point — a pyramid built
 * from a feed barrelman has not imported.
 *
 * An answer of "no such route" is a fact about the data and stays cached;
 * a request that lost the network is not, and the next tap asks again.
 */
export function resolveRouteRef(ref: PortolanRouteRef): Promise<ResolvedTransitRoute | null> {
  const hit = resolved.get(ref.key)
  if (hit) return hit
  const pending = api
    .get<ResolvedTransitRoute>('/transit/resolve-route', {
      params: {
        routeId: ref.routeId,
        lat: ref.lat,
        lng: ref.lng,
        ...(ref.mode ? { mode: ref.mode } : {}),
      },
    })
    .then(({ data }) => (data?.feedId && data?.routeId ? data : null))
    .catch((err: any) => {
      if (!err?.response) resolved.delete(ref.key)
      return null
    })
  resolved.set(ref.key, pending)
  return pending
}

/** Test seam: forget every resolved pair. */
export function resetResolvedRoutes() {
  resolved.clear()
}
