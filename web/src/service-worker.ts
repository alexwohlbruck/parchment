/// <reference lib="webworker" />
/**
 * Service worker: offline app shell + opportunistic runtime caches.
 *
 * The build precaches only the shell (index.html, the entry chunk, the
 * MapLibre worker pair) — the dist is far too large to install wholesale.
 * Everything else is cached as the user touches it:
 *
 *   - `app-assets`: hashed lazy chunks. Content-addressed, so cache-first
 *     is exact; old hashes age out by LRU.
 *   - `map-static`: glyphs, sprites, 3D models. Same-origin, versioned by
 *     deploy only.
 *   - `map-tiles`: basemap/layer tiles through the API's /proxy/*, plus the
 *     third-party raster sources (satellite imagery, terrain). Bounded LRU
 *     so recently seen areas of the map survive a restart offline — the
 *     first step toward offline maps, not the final architecture for
 *     downloadable regions.
 *
 * Auth `token` query params are stripped from tile cache keys so the same
 * tile isn't stored once per session credential.
 */

import { clientsClaim } from 'workbox-core'
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'

declare let self: ServiceWorkerGlobalScope

self.skipWaiting()
clientsClaim()
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// Every navigation serves the app shell — this is what makes a cold offline
// launch render at all.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')))

const DAY = 24 * 60 * 60

// Tile sources: the app's own proxy (any origin — the API host differs from
// the page origin) and the third-party raster hosts used by the basemap.
const TILE_PROXY_PATH = /\/proxy\/[^/]+\//
const TILE_HOSTS =
  /(^|\.)(arcgisonline\.com|elevation-tiles-prod\.s3\.amazonaws\.com|tile\.openstreetmap\.org|opentopomap\.org|openrailwaymap\.org|openseamap\.org)$/

const stripAuthParams = {
  cacheKeyWillBeUsed: async ({ request }: { request: Request }) => {
    const url = new URL(request.url)
    url.searchParams.delete('token')
    return url.href
  },
}

registerRoute(
  ({ url }) =>
    TILE_PROXY_PATH.test(url.pathname) || TILE_HOSTS.test(url.hostname),
  new CacheFirst({
    cacheName: 'map-tiles',
    plugins: [
      stripAuthParams,
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({
        maxEntries: 2500,
        maxAgeSeconds: 30 * DAY,
        purgeOnQuotaError: true,
      }),
    ],
  }),
)

registerRoute(
  ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/assets/'),
  new CacheFirst({
    cacheName: 'app-assets',
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({
        maxEntries: 600,
        maxAgeSeconds: 60 * DAY,
        purgeOnQuotaError: true,
      }),
    ],
  }),
)

registerRoute(
  ({ url, sameOrigin }) =>
    sameOrigin && /^\/(fonts|sprites|models)\//.test(url.pathname),
  new CacheFirst({
    cacheName: 'map-static',
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({
        maxEntries: 500,
        maxAgeSeconds: 60 * DAY,
        purgeOnQuotaError: true,
      }),
    ],
  }),
)
