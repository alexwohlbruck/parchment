import { Elysia } from 'elysia'
import { requireAuth } from '../middleware/auth.middleware'
import { integrationManager } from '../services/integrations'
import {
  IntegrationCapabilityId,
  IntegrationId,
} from '../types/integration.types'
import { logError } from '../lib/logger'
import {
  ISOCHRONE_MODES,
  MAX_CONTOURS,
  maxDurationForMode,
  type IsochroneMode,
} from '../types/isochrone.types'

const app = new Elysia({ prefix: '/proxy' })

/** Upstream timeout for everything but isochrones. */
const DEFAULT_BARRELMAN_TIMEOUT_MS = 10_000

interface BarrelmanProxyOptions {
  /** Cache-Control on the response we return. Default 'no-cache'. */
  cacheControl?: string
  /** Upstream timeout. Default 10s. */
  timeoutMs?: number
  /**
   * Forward the upstream JSON error body instead of replacing it with a
   * generic message. Only for endpoints whose 4xx bodies say something the
   * client can act on — isochrone's validation messages name the offending
   * parameter and its limit, which is worth surfacing.
   */
  forwardErrorBody?: boolean
}

/**
 * Proxy a request to Barrelman. Handles integration config lookup, auth
 * header, error response wrapping, and timeout.
 */
async function proxyBarrelman(
  path: string,
  query: Record<string, any>,
  options: BarrelmanProxyOptions = {},
): Promise<Response> {
  const {
    cacheControl = 'no-cache',
    timeoutMs = DEFAULT_BARRELMAN_TIMEOUT_MS,
    forwardErrorBody = false,
  } = options

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
    { headers, signal: AbortSignal.timeout(timeoutMs) },
  )

  if (!response.ok) {
    // Return a clean JSON error instead of forwarding upstream HTML. Opting
    // in to forwardErrorBody passes a JSON body straight through; anything
    // else upstream sends (an HTML error page, say) still gets replaced.
    const body = forwardErrorBody ? await safeJson(response) : null
    return new Response(
      JSON.stringify(body ?? { error: `Upstream error: ${response.status}` }),
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

/** Parse a response body as JSON, or null when it isn't JSON at all. */
async function safeJson(response: Response): Promise<unknown | null> {
  try {
    const body = await response.json()
    return body && typeof body === 'object' ? body : null
  } catch {
    return null
  }
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
      logError(`${errorContext}: ${response.status} ${response.statusText}`)
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
    logError(`${errorContext} proxy error`, error, { params })
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
      logError('Proxy error', error)
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
        logError(
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
          'Cache-Control': 'public, max-age=86400',
        },
      })
    } catch (error) {
      logError('Barrelman tile proxy error', error, { params })
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
  proxyBarrelman('/transit/vehicles', query, { cacheControl: 'no-cache' }),
  { detail: { tags: ['Proxy'], summary: 'Proxy GTFS-RT vehicle positions' } },
)

transitProxy.get('/shapes', ({ query }) =>
  proxyBarrelman('/transit/shapes', query, { cacheControl: 'public, max-age=86400' }),
  { detail: { tags: ['Proxy'], summary: 'Proxy route shape geometry' } },
)

transitProxy.get('/route-vehicles', ({ query }) =>
  proxyBarrelman('/transit/route-vehicles', query, { cacheControl: 'no-cache' }),
  { detail: { tags: ['Proxy'], summary: 'Proxy route-specific vehicle positions' } },
)

transitProxy.get('/trip-stops', ({ query }) =>
  proxyBarrelman('/transit/trip-stops', query, { cacheControl: 'no-cache' }),
  { detail: { tags: ['Proxy'], summary: 'Proxy trip stop times' } },
)

transitProxy.get('/route-detail', ({ query }) =>
  proxyBarrelman('/transit/route-detail', query, { cacheControl: 'public, max-age=3600' }),
  { detail: { tags: ['Proxy'], summary: 'Proxy route detail with stops and shape' } },
)

transitProxy.get('/departures', ({ query }) =>
  proxyBarrelman('/transit/departures', query, { cacheControl: 'public, max-age=30' }),
  { detail: { tags: ['Proxy'], summary: 'Proxy upcoming departures at a stop' } },
)

transitProxy.get('/bikes-allowed', ({ query }) =>
  proxyBarrelman('/transit/bikes-allowed', query, { cacheControl: 'public, max-age=3600' }),
  { detail: { tags: ['Proxy'], summary: 'Batch check bikes_allowed for routes' } },
)

transitProxy.get('/station/:feedId/:stopId', ({ params }) =>
  proxyBarrelman(
    `/transit/station/${encodeURIComponent(params.feedId)}/${encodeURIComponent(params.stopId)}`,
    {},
    { cacheControl: 'public, max-age=3600' },
  ),
  { detail: { tags: ['Proxy'], summary: 'Proxy station detail with entrances and buildings' } },
)

transitProxy.get('/nearest-entrance', ({ query }) =>
  proxyBarrelman('/transit/nearest-entrance', query, { cacheControl: 'public, max-age=3600' }),
  { detail: { tags: ['Proxy'], summary: 'Proxy nearest station entrance lookup' } },
)

app.use(transitProxy)

// ── GBFS shared mobility proxy ──────────────────────────────────────

// Prefix is relative to `app`, which already contributes `/proxy` — spelling
// it out here again would mount these at /proxy/proxy/gbfs.
const gbfsProxy = new Elysia({ prefix: '/gbfs' }).use(requireAuth)

gbfsProxy.get('/nearby-stations', ({ query }) =>
  proxyBarrelman('/gbfs/nearby-stations', query, { cacheControl: 'no-cache' }),
  { detail: { tags: ['Proxy'], summary: 'Proxy GBFS nearby stations with availability' } },
)

gbfsProxy.get('/systems', ({ query }) =>
  proxyBarrelman('/gbfs/systems', query, { cacheControl: 'public, max-age=3600' }),
  { detail: { tags: ['Proxy'], summary: 'Proxy GBFS system catalog' } },
)

app.use(gbfsProxy)

// ── Isochrone proxy (authenticated) ─────────────────────────────────

/**
 * Isochrones are far slower than the rest of Barrelman: a transit contour
 * fans out to hundreds of per-stop GraphHopper searches, and GraphHopper's
 * own per-search timeout is 60s. The shared 10s budget would abort a
 * perfectly healthy request, so this endpoint gets its own.
 */
const ISOCHRONE_TIMEOUT_MS = 60_000

/**
 * Reject isochrone parameters we can rule out without an upstream round
 * trip. Barrelman validates too, and `forwardErrorBody` surfaces its
 * messages verbatim — this exists to stop the requests that are expensive
 * to discover upstream (a 40-contour transit fan-out) or plainly malformed.
 *
 * Deliberately stricter than Barrelman on one point: only the canonical mode
 * names are accepted, not its aliases ('foot', 'cycling', …). Returns an
 * error message, or null when the query is acceptable.
 */
function validateIsochroneQuery(query: Record<string, unknown>): string | null {
  const lat = Number(query.lat)
  const lng = Number(query.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return 'lat and lng are required and must be numbers'
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return 'lat must be [-90,90], lng must be [-180,180]'
  }

  const mode = query.mode ? String(query.mode) : 'walk'
  if (!(ISOCHRONE_MODES as readonly string[]).includes(mode)) {
    return `Unsupported mode "${mode}". Supported: ${ISOCHRONE_MODES.join(', ')}`
  }

  if (query.durations) {
    const durations = String(query.durations).split(',').filter(Boolean)
    if (durations.length > MAX_CONTOURS) {
      return `At most ${MAX_CONTOURS} durations per request`
    }
    const limit = maxDurationForMode(mode as IsochroneMode)
    for (const raw of durations) {
      const seconds = Number(raw)
      if (!Number.isFinite(seconds) || seconds <= 0) {
        return `Invalid duration "${raw}" — expected a positive number of seconds`
      }
      if (seconds > limit) {
        return `Duration ${seconds}s exceeds the ${limit}s limit for mode "${mode}"`
      }
    }
  }

  return null
}

function badRequest(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  })
}

// No prefix: `app` already contributes `/proxy`, and mounting the collection
// root of a prefixed sub-app would hinge on trailing-slash handling.
const isochroneProxy = new Elysia().use(requireAuth)

isochroneProxy.get('/isochrone', ({ query }) => {
  const invalid = validateIsochroneQuery(query)
  if (invalid) return badRequest(invalid)

  return proxyBarrelman('/isochrone', query, {
    // Transit contours are a function of the departure time, so a cached
    // answer goes stale in a way the client has no way to notice.
    cacheControl: 'no-cache',
    timeoutMs: ISOCHRONE_TIMEOUT_MS,
    forwardErrorBody: true,
  })
}, {
  detail: {
    tags: ['Proxy'],
    summary: 'Proxy reachability polygons for a point',
    description:
      'Returns a GeoJSON FeatureCollection with one polygon per requested ' +
      'contour, ordered smallest first. `durations` is a comma-separated ' +
      'list of budgets in seconds; `mode` is one of walk, bike, car, transit.',
  },
})

isochroneProxy.get('/isochrone/modes', () =>
  proxyBarrelman('/isochrone/modes', {}, { cacheControl: 'public, max-age=3600' }),
  { detail: { tags: ['Proxy'], summary: 'Proxy supported isochrone modes and limits' } },
)

app.use(isochroneProxy)

export default app
