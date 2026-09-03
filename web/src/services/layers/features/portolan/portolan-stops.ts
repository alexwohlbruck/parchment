/**
 * Which OSM object a GTFS stop is.
 *
 * Portolan matches every drawn station to the OSM object that is really the
 * same place — one-to-one on name, mode class and distance — and publishes the
 * result as `<feed>/stops.json`, keyed by the `<feed-onestop>:<stop_id>` pair
 * its tiles already carry.
 *
 * Nothing else can answer this. A name cannot: New York has three stations
 * called "Chambers St", and searching from the J/Z platform opened the A/C/E
 * one 428 m away. Distance cannot either, and fails more quietly — the nearest
 * mapped node to that platform is Brooklyn Bridge–City Hall, 33 m through the
 * passageway. Only the join portolan already computed is exact.
 *
 * Same shape as the bullet index beside it: fetched once per feed per session,
 * degrading to null everywhere — no barrelman, no pyramid, a feed built before
 * the index existed. A miss means the caller falls back to whatever it did
 * before, which is a worse link rather than none.
 */
import { reactive } from 'vue'
import { api } from '@/lib/api'
import { feedsAt } from './portolan-bullets'

/** `<feed-onestop>:<stop_id>` → `"node/123"`. */
type StopIndex = Record<string, string>

const proxyBase = () => `${api.defaults.baseURL}/proxy/portolan`

/** Loaded stop indexes, per feed. `null` marks a feed that publishes none. */
const indexes = reactive<Record<string, StopIndex | null>>({})
const pending = new Map<string, Promise<void>>()
/** Bumped when a fetch lands, so a consumer computed re-runs. */
const state = reactive({ generation: 0 })

function ensureIndex(feed: string): Promise<void> {
  const inFlight = pending.get(feed)
  if (inFlight) return inFlight
  if (feed in indexes) return Promise.resolve()
  const p = fetch(`${proxyBase()}/${encodeURIComponent(feed)}/stops.json`)
    .then(r => (r.ok ? r.json() : null))
    .catch(() => null)
    .then(idx => {
      indexes[feed] = idx && typeof idx === 'object' ? (idx as StopIndex) : null
      pending.delete(feed)
      state.generation++
    })
  pending.set(feed, p)
  return p
}

/**
 * Load what is needed to resolve stops near a point. Safe to call on every
 * render: one fetch per feed per session.
 */
export async function ensureStopIndexAt(lat?: number, lng?: number): Promise<void> {
  if (lat === undefined || lng === undefined) return
  await Promise.all(feedsAt(lat, lng).map(ensureIndex))
}

/**
 * The OSM object a stop is, as `"node/123"`, or null.
 *
 * `feedOnestopId` comes from Barrelman, whose own feed ids are local to its
 * database; the onestop id is the identity the stop has outside it, and what
 * portolan keyed by.
 */
export function osmForStop(
  feedOnestopId?: string,
  stopId?: string,
  lat?: number,
  lng?: number,
): string | null {
  // touch the generation so Vue re-evaluates when a fetch lands
  void state.generation
  if (!feedOnestopId || !stopId) return null
  const key = `${feedOnestopId}:${stopId}`
  const feeds = lat !== undefined && lng !== undefined ? feedsAt(lat, lng) : Object.keys(indexes)
  for (const feed of feeds) {
    const hit = indexes[feed]?.[key]
    if (hit) return hit
  }
  return null
}

/** Test seam: forget everything fetched. */
export function resetPortolanStops(): void {
  for (const k of Object.keys(indexes)) delete indexes[k]
  pending.clear()
  state.generation++
}

/** Test seam: install one feed's index without a fetch. */
export function setPortolanStopIndex(feed: string, idx: StopIndex | null): void {
  indexes[feed] = idx
  state.generation++
}
