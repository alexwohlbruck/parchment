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
import { api } from '@/lib/api'
import type { PortolanIndexEntry } from '@/types/portolan.types'

export interface PortolanBullet {
  label: string
  color?: string
  /** Portolan's curated outline; absent (or "") is the default circle. */
  shape?: string
  mode?: string
}

type RouteIndex = Record<string, PortolanBullet>

const proxyBase = () => `${api.defaults.baseURL}/proxy/portolan`

/** Loaded route indexes, per feed. `null` marks a feed that has none. */
const indexes = reactive<Record<string, RouteIndex | null>>({})
const pending = new Map<string, Promise<void>>()

let regionsPromise: Promise<PortolanIndexEntry[]> | null = null
let regions: PortolanIndexEntry[] = []
/** Bumped when regions arrive, so a consumer computed re-runs. */
const state = reactive({ generation: 0 })

function ensureRegions(): Promise<PortolanIndexEntry[]> {
  if (!regionsPromise) {
    regionsPromise = fetch(`${proxyBase()}/index.json`)
      .then(r => (r.ok ? r.json() : []))
      .then(list => (Array.isArray(list) ? list : []))
      .catch(() => [])
      .then(list => {
        regions = list
        state.generation++
        return list
      })
  }
  return regionsPromise
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
  await ensureRegions()
  await Promise.all(feedsAt(lat, lng).map(ensureIndex))
}

/**
 * The curated bullet for a route, or null.
 *
 * Ids are matched the way the isolation filter matches them: the tile's
 * own id first, then a `:id` suffix, because a group pyramid prefixes
 * every feed after the first — the 2 is `f3:2` in northeast-corridor and
 * plain `2` in mta-subway, and the panel only ever has the bare one.
 */
export function bulletFor(routeId: string, lat?: number, lng?: number): PortolanBullet | null {
  // touch the generation so Vue re-evaluates when a fetch lands
  void state.generation
  if (!routeId) return null
  const feeds =
    lat !== undefined && lng !== undefined ? feedsAt(lat, lng) : Object.keys(indexes)
  const suffix = `:${routeId}`
  for (const feed of feeds) {
    const idx = indexes[feed]
    if (!idx) continue
    const exact = idx[routeId]
    if (exact) return exact
    for (const id of Object.keys(idx)) {
      if (id.endsWith(suffix)) return idx[id]
    }
  }
  return null
}

/** Test seam: forget everything fetched. */
export function resetPortolanBullets(regionList: PortolanIndexEntry[] = []) {
  for (const k of Object.keys(indexes)) delete indexes[k]
  pending.clear()
  regionsPromise = regionList.length ? Promise.resolve(regionList) : null
  regions = regionList
  state.generation++
}

/** Test seam: install one feed's index without a fetch. */
export function setPortolanRouteIndex(feed: string, idx: RouteIndex | null) {
  indexes[feed] = idx
  state.generation++
}
