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
 *   - `map-globe`: the bundled zoomed-out globe tiles. Versioned in their
 *     path, so cache-first is exact; the whole set is a few MB.
 *   - `map-tiles`: basemap/layer tiles through the API's /proxy/*, plus the
 *     third-party raster sources (satellite imagery, terrain). Bounded LRU
 *     so recently seen areas of the map survive a restart offline.
 *   - `offline-regions`: areas the user saved for offline use. Never expires;
 *     the app adds and prunes entries, and it answers before any other cache.
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
import { CacheFirst, NetworkOnly, StaleWhileRevalidate } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'
import type { RouteHandlerCallbackOptions } from 'workbox-core/types'
import type { Strategy } from 'workbox-strategies'
import { OFFLINE_CACHE, offlineCacheKey, toSavedResponse } from './lib/offline/offline-cache'

declare let self: ServiceWorkerGlobalScope

self.skipWaiting()
clientsClaim()
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// Every navigation serves the app shell — this is what makes a cold offline
// launch render at all. Except `/oauth/`: those are real static pages that
// close themselves, and serving the shell there boots a second copy of the app
// inside the OAuth popup.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/^\/oauth\//],
  }),
)

const DAY = 24 * 60 * 60

// Tile sources: the app's own proxy (any origin — the API host differs from
// the page origin) and the third-party raster hosts used by the basemap.
const TILE_PROXY_PATH = /\/proxy\/[^/]+\//
/** Google requires its own caching headers be honoured, so its tiles go straight to the browser cache. */
const UNCACHED_PROXY_PATH = /\/proxy\/google\//
const TILE_HOSTS =
  /(^|\.)(arcgisonline\.com|nationalmap\.gov|maps\.eox\.at|elevation-tiles-prod\.s3\.amazonaws\.com|tiles\.mapterhorn\.com|tile\.openstreetmap\.org|opentopomap\.org|openrailwaymap\.org|openseamap\.org)$/

const stripAuthParams = {
  cacheKeyWillBeUsed: async ({ request }: { request: Request }) => {
    const url = new URL(request.url)
    url.searchParams.delete('token')
    return url.href
  },
}

const offlineCache = caches.open(OFFLINE_CACHE)

async function refreshSaved(key: string, request: Request) {
  try {
    const saved = await toSavedResponse(await fetch(request))
    if (saved) await (await offlineCache).put(key, saved)
  } catch {
    // Offline or flaky: the saved copy stays.
  }
}

/** Saved regions answer first. A proxy tile refreshes its saved copy behind it. */
function savedFirst(strategy: Strategy, revalidate = false) {
  return async ({ request, event }: RouteHandlerCallbackOptions) => {
    const key = offlineCacheKey(request.url)
    const saved = await (await offlineCache).match(key)
    if (!saved) return strategy.handle({ request, event })
    if (revalidate) event.waitUntil(refreshSaved(key, request))
    return saved
  }
}

const tileCachePlugins = [
  stripAuthParams,
  new CacheableResponsePlugin({ statuses: [200] }),
  new ExpirationPlugin({
    maxEntries: 2500,
    maxAgeSeconds: 30 * DAY,
    purgeOnQuotaError: true,
  }),
]

// Our tile URLs stay the same across releases, so a cached tile is drawn at
// once and refreshed behind it; an import shows up on the next visit.
registerRoute(
  ({ url }) => TILE_PROXY_PATH.test(url.pathname) && !UNCACHED_PROXY_PATH.test(url.pathname),
  savedFirst(new StaleWhileRevalidate({ cacheName: 'map-tiles', plugins: tileCachePlugins }), true),
)

registerRoute(
  ({ url }) => TILE_HOSTS.test(url.hostname),
  savedFirst(new CacheFirst({ cacheName: 'map-tiles', plugins: tileCachePlugins })),
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
  ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/globe/'),
  new CacheFirst({
    cacheName: 'map-globe',
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 2000, maxAgeSeconds: 180 * DAY, purgeOnQuotaError: true }),
    ],
  }),
)

registerRoute(
  ({ url, sameOrigin }) =>
    sameOrigin && /^\/(fonts|sprites|models)\//.test(url.pathname),
  savedFirst(
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
  ),
)

// Tiles from anywhere else, such as a custom layer's own server, only ever
// come from a saved region; online they pass straight through.
registerRoute(
  ({ url, request }) => request.method === 'GET' && /\/\d+\/\d+\/\d+(\.\w+)?$/.test(url.pathname),
  savedFirst(new NetworkOnly()),
)
