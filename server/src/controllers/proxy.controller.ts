import { Elysia } from 'elysia'
import { requireAuth } from '../middleware/auth.middleware'
import { integrationManager } from '../services/integrations'
import {
  IntegrationCapabilityId,
  IntegrationId,
} from '../types/integration.types'

const app = new Elysia({ prefix: '/proxy' })

/**
 * Proxy a request to Barrelman's transit API. Handles integration
 * config lookup, auth header, error response wrapping, and timeout.
 */
async function proxyBarrelman(
  path: string,
  query: Record<string, any>,
  cacheControl: string = 'no-cache',
): Promise<Response> {
  const systemIntegration = integrationManager
    .getConfiguredIntegrations()
    .find((i) => i.integrationId === IntegrationId.BARRELMAN)

  const config = systemIntegration?.config as
    | { host?: string; apiKey?: string }
    | undefined
  if (!config?.host) {
    return new Response(JSON.stringify({ error: 'Barrelman not configured' }), {
      status: 501,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v != null && v !== '') params.set(k, String(v))
  }

  const headers: Record<string, string> = {}
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`
  }

  const response = await fetch(
    `${config.host}${path}?${params}`,
    { headers, signal: AbortSignal.timeout(10_000) },
  )

  if (!response.ok) {
    // Return a clean JSON error instead of forwarding upstream HTML
    return new Response(
      JSON.stringify({ error: `Upstream error: ${response.status}` }),
      { status: response.status, headers: { 'Content-Type': 'application/json' } },
    )
  }

  return new Response(await response.arrayBuffer(), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': cacheControl,
    },
  })
}

// Helper function to proxy tile requests with integration API key
async function proxyTileRequest(
  integrationId: IntegrationId,
  targetUrlFn: (apiKey: string, params: any) => string,
  params: any,
  errorContext: string,
): Promise<Response> {
  try {
    const systemIntegration = integrationManager
      .getConfiguredIntegrations()
      .find((i) => i.integrationId === integrationId)

    if (
      !systemIntegration ||
      (!systemIntegration.config?.apiKey &&
        !systemIntegration.config?.accessToken)
    ) {
      return new Response(`${integrationId} not configured`, { status: 501 })
    }

    const apiKey =
      systemIntegration.config.apiKey || systemIntegration.config.accessToken
    const targetUrl = targetUrlFn(apiKey, params)

    const response = await fetch(targetUrl)

    if (!response.ok) {
      console.error(
        `${errorContext}: ${response.status} ${response.statusText}`,
      )
      return new Response('Upstream error', { status: response.status })
    }

    const data = await response.arrayBuffer()

    return new Response(data, {
      headers: {
        'Content-Type': 'application/x-protobuf',
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch (error) {
    console.error(`${errorContext} proxy error:`, error, 'params:', params)
    return new Response('Proxy error', { status: 500 })
  }
}

// Proxy route for Loom tile service
app.get(
  '/loom/:service/geo/:z/:x/:y',
  async ({ params }) => {
    const { service, z, x, y } = params

    try {
      const targetUrl = `https://loom.cs.uni-freiburg.de/tiles/${service}/geo/${z}/${x}/${y}.mvt`
      const response = await fetch(targetUrl)

      if (!response.ok) {
        throw new Error(
          `Failed to fetch from Loom: ${response.status} ${response.statusText}`,
        )
      }

      const data = await response.arrayBuffer()

      return new Response(data, {
        headers: {
          'Content-Type': 'application/x-protobuf',
          'Cache-Control': 'public, max-age=86400',
        },
      })
    } catch (error) {
      console.error('Proxy error:', error)
      return new Response('Proxy error', { status: 500 })
    }
  },
  {
    detail: {
      tags: ['Proxy'],
      summary: 'Proxy Loom tile service',
    },
  },
)

// Proxy Mapillary vector tiles with token from integration
app.get(
  '/mapillary/:dataset/:version/:z/:x/:y',
  async ({ params }) => {
    return proxyTileRequest(
      IntegrationId.MAPILLARY,
      (accessToken, { dataset, version, z, x, y }) =>
        `https://tiles.mapillary.com/maps/vtp/${dataset}/${version}/${z}/${x}/${y}?access_token=${encodeURIComponent(
          accessToken,
        )}`,
      params,
      'Mapillary',
    )
  },
  {
    detail: {
      tags: ['Proxy'],
      summary: 'Proxy Mapillary vector tiles',
    },
  },
)

// Proxy Transitland route tiles with API key from integration
app.get(
  '/transitland/routes/:z/:x/:y',
  async ({ params }) => {
    return proxyTileRequest(
      IntegrationId.TRANSITLAND,
      (apiKey, { z, x, y }) =>
        `https://transit.land/api/v2/tiles/routes/tiles/${z}/${x}/${y}.pbf?apikey=${encodeURIComponent(
          apiKey,
        )}`,
      params,
      'Transitland routes',
    )
  },
  {
    detail: {
      tags: ['Proxy'],
      summary: 'Proxy Transitland route tiles',
    },
  },
)

// Proxy Transitland stop tiles with API key from integration
app.get(
  '/transitland/stops/:z/:x/:y',
  async ({ params }) => {
    return proxyTileRequest(
      IntegrationId.TRANSITLAND,
      (apiKey, { z, x, y }) =>
        `https://transit.land/api/v2/tiles/stops/tiles/${z}/${x}/${y}.pbf?apikey=${encodeURIComponent(
          apiKey,
        )}`,
      params,
      'Transitland stops',
    )
  },
  {
    detail: {
      tags: ['Proxy'],
      summary: 'Proxy Transitland stop tiles',
    },
  },
)

// Proxy Martin tile requests through Barrelman integration config.
// Martin serves vector tiles at /{source}/{z}/{x}/{y} (no /tiles/ prefix).
app.get(
  '/barrelman/:source/:z/:x/:y',
  async ({ params }) => {
    try {
      const systemIntegration = integrationManager
        .getConfiguredIntegrations()
        .find((i) => i.integrationId === IntegrationId.BARRELMAN)

      const martinHost =
        (systemIntegration?.config as { martinHost?: string })?.martinHost ||
        process.env.MARTIN_HOST ||
        'http://localhost:5002'
      const tileKey = (systemIntegration?.config as { tileKey?: string })
        ?.tileKey
      const { source, z, x, y } = params
      const tileUrl = new URL(`/${source}/${z}/${x}/${y}`, martinHost)
      if (tileKey) tileUrl.searchParams.set('token', tileKey)

      const response = await fetch(tileUrl.toString())

      if (!response.ok) {
        console.error(
          `Barrelman tile proxy: ${response.status} ${response.statusText}`,
        )
        return new Response('Upstream error', { status: response.status })
      }

      const data = await response.arrayBuffer()

      return new Response(data, {
        headers: {
          'Content-Type':
            response.headers.get('content-type') ||
            'application/x-protobuf',
          // These tiles are regenerated on GTFS/LOOM rebuilds. In DEV we never
          // cache them (Martin serves live from the matviews), so geometry
          // changes always show on reload without cache-busting the URL or
          // clearing the client template cache. In PROD keep a short browser
          // cache; a CDN (with purge-on-rebuild) handles server-side perf.
          'Cache-Control':
            process.env.NODE_ENV === 'production'
              ? 'public, max-age=60, stale-while-revalidate=600'
              : 'no-store',
        },
      })
    } catch (error) {
      console.error('Barrelman tile proxy error:', error, 'params:', params)
      return new Response('Proxy error', { status: 500 })
    }
  },
  {
    detail: {
      tags: ['Proxy'],
      summary: 'Proxy Barrelman tile requests',
    },
  },
)

// ── Transit proxy endpoints (authenticated) ─────────────────────
// All transit endpoints require auth to prevent anonymous enumeration
// of live vehicle positions and route topology.
const transitProxy = new Elysia({ prefix: '/transit' }).use(requireAuth)

transitProxy.get('/vehicles', ({ query }) =>
  proxyBarrelman('/transit/vehicles', query, 'no-cache'),
  { detail: { tags: ['Proxy'], summary: 'Proxy GTFS-RT vehicle positions' } },
)

transitProxy.get('/shapes', ({ query }) =>
  proxyBarrelman('/transit/shapes', query, 'public, max-age=86400'),
  { detail: { tags: ['Proxy'], summary: 'Proxy route shape geometry' } },
)

transitProxy.get('/route-vehicles', ({ query }) =>
  proxyBarrelman('/transit/route-vehicles', query, 'no-cache'),
  { detail: { tags: ['Proxy'], summary: 'Proxy route-specific vehicle positions' } },
)

transitProxy.get('/trip-stops', ({ query }) =>
  proxyBarrelman('/transit/trip-stops', query, 'no-cache'),
  { detail: { tags: ['Proxy'], summary: 'Proxy trip stop times' } },
)

transitProxy.get('/route-detail', ({ query }) =>
  proxyBarrelman('/transit/route-detail', query, 'public, max-age=3600'),
  { detail: { tags: ['Proxy'], summary: 'Proxy route detail with stops and shape' } },
)

transitProxy.get('/departures', ({ query }) =>
  proxyBarrelman('/transit/departures', query, 'public, max-age=30'),
  { detail: { tags: ['Proxy'], summary: 'Proxy upcoming departures at a stop' } },
)

transitProxy.get('/bikes-allowed', ({ query }) =>
  proxyBarrelman('/transit/bikes-allowed', query, 'public, max-age=3600'),
  { detail: { tags: ['Proxy'], summary: 'Batch check bikes_allowed for routes' } },
)

transitProxy.get('/station/:feedId/:stopId', ({ params }) =>
  proxyBarrelman(
    `/transit/station/${encodeURIComponent(params.feedId)}/${encodeURIComponent(params.stopId)}`,
    {},
    'public, max-age=3600',
  ),
  { detail: { tags: ['Proxy'], summary: 'Proxy station detail with entrances and buildings' } },
)

transitProxy.get('/nearest-entrance', ({ query }) =>
  proxyBarrelman('/transit/nearest-entrance', query, 'public, max-age=3600'),
  { detail: { tags: ['Proxy'], summary: 'Proxy nearest station entrance lookup' } },
)

app.use(transitProxy)

// ── GBFS shared mobility proxy ──────────────────────────────────────

const gbfsProxy = new Elysia({ prefix: '/proxy/gbfs' }).use(requireAuth)

gbfsProxy.get('/nearby-stations', ({ query }) =>
  proxyBarrelman('/gbfs/nearby-stations', query, 'no-cache'),
  { detail: { tags: ['Proxy'], summary: 'Proxy GBFS nearby stations with availability' } },
)

gbfsProxy.get('/systems', ({ query }) =>
  proxyBarrelman('/gbfs/systems', query, 'public, max-age=3600'),
  { detail: { tags: ['Proxy'], summary: 'Proxy GBFS system catalog' } },
)

app.use(gbfsProxy)


export default app
