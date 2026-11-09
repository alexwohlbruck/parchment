/**
 * Portolan's bullet vocabulary, for the parts of parchment that are not
 * the map.
 *
 * A route's bullet is curated: `shape:` on a route or an agency puts a
 * Mexico City numeral in a notched square and a Vienna one in a plain
 * square, and `color:`/`name:` override what the feed says. Portolan
 * resolves all of that while it builds and bakes the answer into the
 * tiles — which is fine for the map and useless for the panel beside it,
 * which holds a route id from a routing engine and has never heard of a
 * style document. So the pyramid publishes the resolved answer as
 * `<feed>/routes.json`, and this reads it.
 *
 * Which pyramid? The one whose bounds contain the place being looked at.
 * The index carries bounds for every feed, so a station in Brooklyn asks
 * NYC and not Vienna, and the smallest covering pyramid wins — a city
 * feed knows more about its own routes than a continental one riding
 * through.
 *
 * Everything degrades to null: no barrelman, no portolan, no pyramid
 * here, an id nothing draws. A bullet with no curated style is a circle
 * in the feed's own colours, which is what it always was.
 */
import { reactive } from 'vue'
import {
  proxyBase,
  ensureRegions,
  _resetRegionsForTest,
} from './portolan-client'
import { api } from '@/lib/api'
import { orderBullets } from '@/lib/transit/transit-bullets'
import { portolanClassOf, type PortolanIndexEntry } from '@/types/portolan.types'

export interface PortolanBullet {
  label: string
  color?: string
  /** Portolan's curated outline; absent (or "") is the default circle. */
  shape?: string
  mode?: string
}

type RouteIndex = Record<string, PortolanBullet>


/** Loaded route indexes, per feed. `null` marks a feed that has none. */
const indexes = reactive<Record<string, RouteIndex | null>>({})
const pending = new Map<string, Promise<void>>()

let regions: PortolanIndexEntry[] = []
/** Bumped when regions arrive, so a consumer computed re-runs. */
const state = reactive({ generation: 0 })

let regionsHydrated: Promise<PortolanIndexEntry[]> | null = null

function hydrateRegions(): Promise<PortolanIndexEntry[]> {
  if (!regionsHydrated) {
    regionsHydrated = ensureRegions().then(list => {
      regions = list
      state.generation++
      return list
    })
  }
  return regionsHydrated
}

function ensureIndex(feed: string): Promise<void> {
  const inFlight = pending.get(feed)
  if (inFlight) return inFlight
  if (feed in indexes) return Promise.resolve()
  const p = fetch(`${proxyBase()}/${encodeURIComponent(feed)}/routes.json`)
    .then(r => (r.ok ? r.json() : null))
    .catch(() => null)
    .then(idx => {
      indexes[feed] = idx && typeof idx === 'object' ? (idx as RouteIndex) : null
      pending.delete(feed)
      state.generation++
    })
  pending.set(feed, p)
  return p
}

/** Degrees squared. Only ever compared, never measured — it ranks a city
 *  pyramid above the continental one that also covers it. */
function area(b?: number[]): number {
  if (!b || b.length !== 4) return Number.POSITIVE_INFINITY
  return Math.abs(b[2] - b[0]) * Math.abs(b[3] - b[1])
}

function covers(b: number[] | undefined, lat: number, lng: number): boolean {
  if (!b || b.length !== 4) return false
  return lng >= b[0] && lng <= b[2] && lat >= b[1] && lat <= b[3]
}

/** Feeds whose pyramid covers this point, tightest first. */
export function feedsAt(lat: number, lng: number): string[] {
  return regions
    .filter(r => covers(r.bounds, lat, lng))
    .sort((a, b) => area(a.bounds) - area(b.bounds))
    .map(r => r.feed)
}

/**
 * Load what is needed to letter bullets at this place. Safe to call on
 * every render: the index is fetched once per session and each feed's
 * routes once per feed.
 */
export async function ensureBulletsAt(lat?: number, lng?: number): Promise<void> {
  if (lat === undefined || lng === undefined) return
  await hydrateRegions()
  await Promise.all(feedsAt(lat, lng).map(ensureIndex))
}

/**
 * The curated bullet for a route, or null.
 *
 * Ids are matched the way the isolation filter matches them: the tile's
 * own id first, then a `:id` suffix, because a group pyramid prefixes
 * every feed after the first — the 2 is `f3:2` in northeast-corridor and
 * plain `2` in mta-subway, and the panel only ever has the bare one.
 *
 * A bare id is not unique across agencies, though, and the suffix match
 * happily crosses one. The New York subway's 4, 5, 6 and 7 are also the
 * Long Island Rail Road's route ids, stored as `f1:4`…`f1:7` in the
 * northeast-corridor pyramid, and no NYC subway pyramid is published — so
 * every Lexington Avenue bullet in a station header came back as a
 * Ronkonkoma, Montauk or Long Beach Branch pill. Passing the route's GTFS
 * `route_type` narrows the match to bullets of the same mode class, which
 * is what separates a metro 4 from a regional one.
 *
 * Mode is not enough between two railroads. Metro-North's Harlem line and
 * an LIRR branch are both regional and both answer to `2`, so the first
 * `:2` in key order won — which is how the Harlem line came up lettered
 * "Hempstead Branch". Pass `name` (the route's own short or long name) and
 * a cross-agency match must AGREE with it. When several candidates remain
 * and none agrees, the answer is null rather than a guess: an uncurated
 * circle in the feed's own colours is right, and another railroad's pill
 * is not.
 */
export function bulletFor(
  routeId: string,
  lat?: number,
  lng?: number,
  routeType?: number | null,
  name?: string | null,
): PortolanBullet | null {
  // touch the generation so Vue re-evaluates when a fetch lands
  void state.generation
  if (!routeId) return null
  const feeds =
    lat !== undefined && lng !== undefined ? feedsAt(lat, lng) : Object.keys(indexes)
  const wanted = portolanClassOf(routeType)
  // A bullet that never declared a mode can't contradict one — take it.
  const usable = (b?: PortolanBullet) =>
    !!b && (!wanted || !b.mode || b.mode === wanted)
  const norm = (v?: string | null) => (v ?? '').trim().toLowerCase()
  const wantedName = norm(name)
  const agrees = (b: PortolanBullet) => !!wantedName && norm(b.label) === wantedName
  const suffix = `:${routeId}`
  for (const feed of feeds) {
    const idx = indexes[feed]
    if (!idx) continue
    // The feed's own id is unambiguous — no other agency can own it here.
    const exact = idx[routeId]
    if (usable(exact)) return exact

    const candidates = Object.keys(idx)
      .filter(id => id.endsWith(suffix))
      .map(id => idx[id])
      .filter(usable) as PortolanBullet[]
    if (!candidates.length) continue
    const named = candidates.filter(agrees)
    if (named.length) return named[0]
    // Exactly one possibility is not a guess; several without agreement is.
    if (candidates.length === 1) return candidates[0]
    return null
  }
  return null
}

/** Test seam: forget everything fetched. */
export function resetPortolanBullets(regionList: PortolanIndexEntry[] = []) {
  for (const k of Object.keys(indexes)) delete indexes[k]
  pending.clear()
  regionsHydrated = regionList.length ? Promise.resolve(regionList) : null
  _resetRegionsForTest()
  regions = regionList
  state.generation++
}

/** Test seam: install one feed's index without a fetch. */
export function setPortolanRouteIndex(feed: string, idx: RouteIndex | null) {
  indexes[feed] = idx
  state.generation++
}

/** A route as a stop list knows it. */
export interface StopRouteRef {
  routeId: string
  routeShortName: string | null
  routeLongName: string | null
  routeType: number | null
  routeColor: string | null
  routeTextColor?: string | null
}

/** A route's bullet as drawn at one stop: portolan's curated glyph where
 *  the pyramid covering the stop has one, the feed's own name and colours
 *  where it does not. */
export interface ResolvedStopBullet<R extends StopRouteRef = StopRouteRef> {
  route: R
  label: string
  color: string | null
  shape?: string
  /** The feed's text colour — only meaningful for an uncurated bullet. */
  textColor: string | null
}

/**
 * One route's bullet at one stop.
 *
 * The map is usually open beside the stop list drawing the same lines, so
 * the glyphs have to agree — a notched square in one and a plain circle in
 * the other reads as two different routes. Passing the stop's own point
 * picks the pyramid covering it, and the route type keeps a metro 4 from
 * matching a commuter-rail one.
 */
export function stopBulletFor<R extends StopRouteRef>(
  route: R,
  stop: { lat: number; lng: number },
): ResolvedStopBullet<R> {
  const name = route.routeShortName || route.routeLongName
  const b = bulletFor(route.routeId, stop.lat, stop.lng, route.routeType, name)
  return {
    route,
    label: b?.label || name || '',
    color: b?.color || route.routeColor,
    shape: b?.shape,
    textColor: b?.color ? null : route.routeTextColor ?? null,
  }
}

/**
 * A stop's routes as bullets, in the order a station header puts them.
 *
 * The server returns them by its own SQL sort (station-before-transfer,
 * then route type and short name), which reads as a different system from
 * the one the header shows for the same station. `orderBullets` is that
 * shared rule — it sorts by the bullet's own glyph and colour, which is
 * what a rider is actually scanning.
 */
export function stopBulletsFor<R extends StopRouteRef>(
  routes: readonly R[],
  stop: { lat: number; lng: number },
): ResolvedStopBullet<R>[] {
  return orderBullets(
    routes.map(r => stopBulletFor(r, stop)),
    b => ({ label: b.label, color: b.color, id: b.route.routeId }),
  )
}
