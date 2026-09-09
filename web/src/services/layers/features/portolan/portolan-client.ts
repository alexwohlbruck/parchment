/**
 * Shared access to the portolan tile proxy.
 *
 * The pyramid index is fetched once per session and shared: the renderer and
 * the station/route lookups all need it, and each keeping its own cache meant
 * opening the map and opening a station header both paid for it.
 */
import { api } from '@/lib/api'
import type { PortolanIndexEntry } from '@/types/portolan.types'

export const proxyBase = () => `${api.defaults.baseURL}/proxy/portolan`

export const feedUrl = (feed: string, file: string) =>
  `${proxyBase()}/${encodeURIComponent(feed)}/${file}`

let regionsPromise: Promise<PortolanIndexEntry[]> | null = null

export function ensureRegions(): Promise<PortolanIndexEntry[]> {
  if (!regionsPromise) {
    regionsPromise = fetch(`${proxyBase()}/index.json`)
      .then(r => (r.ok ? r.json() : []))
      .then(list => (Array.isArray(list) ? list : []))
      .catch(() => [])
  }
  return regionsPromise
}

/** Test seam — drops the cached index so a suite can re-stub the fetch. */
export function _resetRegionsForTest() {
  regionsPromise = null
}
