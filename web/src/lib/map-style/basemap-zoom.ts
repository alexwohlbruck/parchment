/**
 * How deep the tile server renders the basemap: z14, the OpenMapTiles default,
 * or z15.
 *
 * MapLibre draws every zoom past a source's `maxzoom` by stretching that zoom's
 * tiles, and lays a stretched tile out again for every deeper tile it covers. A
 * z14 tile of a city centre is 300–600 KB, so a close-in view of one is slow.
 * Barrelman can render to z15, and its TileJSON says which it did.
 *
 * Asking for z15 from a server that stopped at z14 is not harmless, though: the
 * z15 tiles 404 and the map goes blank from there in. So the style is built on
 * the depth the last session saw from this tile server, or on z14 if it has
 * never been asked, and the TileJSON is read in the background:
 *
 * - deeper than the style: kept for the next session. Rebuilding now would
 *   throw away every tile already drawn to save a little later.
 * - shallower than the style: the style is rebuilt at once, since the deepest
 *   zooms are already missing.
 * - no TileJSON (a Barrelman from before it served one): the next session
 *   starts at z14 again, which is right for any server.
 */

export const DEFAULT_BASEMAP_MAXZOOM = 14
/** planetiler renders no deeper; a larger answer is a mistake, not a depth. */
const DEEPEST = 15

const REMEMBERED_KEY = 'parchment-basemap-maxzoom'

let maxzoom = DEFAULT_BASEMAP_MAXZOOM
let recalled = false

/** Tile servers already asked, so a style rebuild does not ask again. */
const asked = new Map<string, Promise<boolean>>()

function remembered(): Record<string, number> {
  try {
    const raw = localStorage.getItem(REMEMBERED_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function remember(server: string, value: number | null) {
  try {
    const all = remembered()
    if (value === null) delete all[server]
    else all[server] = value
    localStorage.setItem(REMEMBERED_KEY, JSON.stringify(all))
  } catch {
    // Storage full or disabled: every session starts at z14, as before.
  }
}

function valid(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= DEEPEST
}

/** The basemap source's maxzoom for the style being built. */
export function basemapMaxzoom(): number {
  return maxzoom
}

/** Start from the depth the last session saw from this tile server. Call before the first style is built. */
export function recallBasemapMaxzoom(server: string): void {
  if (recalled) return
  recalled = true
  const value = remembered()[server]
  maxzoom = valid(value) ? value : DEFAULT_BASEMAP_MAXZOOM
}

/**
 * Read the basemap's TileJSON and remember its maxzoom for the next session.
 * Resolves to true when the style has to be rebuilt now: when it asks for zooms
 * the server does not have.
 */
export function probeBasemapMaxzoom(server: string, fetchJson: typeof fetch = fetch): Promise<boolean> {
  const pending = asked.get(server)
  if (pending) return pending
  const probe = (async () => {
    let response: Response
    try {
      response = await fetchJson(`${server}/basemap.json`)
    } catch {
      return false // Offline or unreachable: says nothing about the server.
    }
    if (response.status === 404) {
      remember(server, null)
      return false
    }
    if (!response.ok) return false
    let answer: unknown
    try {
      answer = (await response.json())?.maxzoom
    } catch {
      return false
    }
    if (!valid(answer)) return false
    remember(server, answer)
    if (answer >= maxzoom) return false
    maxzoom = answer
    return true
  })()
  asked.set(server, probe)
  return probe
}

/** Test seam: set the depth and forget what has been recalled and asked. */
export function setBasemapMaxzoom(value: number = DEFAULT_BASEMAP_MAXZOOM): void {
  maxzoom = value
  recalled = false
  asked.clear()
}
