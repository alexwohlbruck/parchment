/**
 * Tile proxy.
 *
 * Map tile sources are fetched by MapLibre itself, which means they can't
 * attach our auth header and are subject to the tile server's CORS policy.
 * These routes exist so those requests can go out from the server instead:
 * they strip CORS out of the equation and keep provider keys server-side.
 *
 * That is the *only* thing that belongs here. Ordinary data endpoints that
 * happen to be served by another service are not proxies — they live in their
 * own module (see transit, gbfs and isochrone controllers, which all call
 * Barrelman through `services/barrelman.service.ts`).
 */

import { Elysia } from 'elysia'
import { integrationManager } from '../services/integrations'
import { IntegrationId } from '../types/integration.types'
import { resolveBarrelmanConfig } from '../services/barrelman.service'
import { logError } from '../lib/logger'

const app = new Elysia({ prefix: '/proxy' })

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

// Proxy portolan transit tiles from the Barrelman host.
//
// Barrelman serves portolan's MVT pyramids at /tiles/portolan/*:
// index.json lists every feed with a cut pyramid (bounds + maxzoom),
// each feed directory holds tiles.json, style.json and {z}/{x}/{y}.mvt.
// Auth mirrors the two existing Barrelman patterns: the integration's
// apiKey rides as a Bearer header (like requestBarrelman) and tileKey as
// ?token= (like the Martin tile proxy) — whichever the host enforces.
//
// tiles.json templates are normalized to RELATIVE so a client resolving
// them against this proxy's URL lands back on the proxy; in practice the
// web client builds tile URLs from index.json alone (fixed template),
// exactly as portolan's own global atlas view does.
app.get(
  '/portolan/*',
  async ({ params }) => {
    const rest = params['*']

    // only pyramid content leaves this route, and never a path escape
    if (rest.includes('..') || !/\.(json|mvt)$/.test(rest)) {
      return new Response('Not found', { status: 404 })
    }

    try {
      const config = resolveBarrelmanConfig()
      if (!config?.host) {
        return new Response('Barrelman not configured', { status: 501 })
      }
      const tileKey = (
        integrationManager
          .getConfiguredIntegrations()
          .find((i) => i.integrationId === IntegrationId.BARRELMAN)
          ?.config as { tileKey?: string }
      )?.tileKey

      const targetUrl = new URL(`/tiles/portolan/${rest}`, config.host)
      if (tileKey) targetUrl.searchParams.set('token', tileKey)

      const headers: Record<string, string> = {}
      if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`

      const response = await fetch(targetUrl.toString(), {
        headers,
        signal: AbortSignal.timeout(10_000),
      })

      // an empty tile is a valid answer inside a pyramid: the cutter only
      // writes tiles a feature touches
      if (response.status === 204) return new Response(null, { status: 204 })

      if (!response.ok) {
        // a missing index.json means portolan isn't deployed on this
        // Barrelman — the client treats 404 as "feature absent", so no log
        if (response.status !== 404) {
          logError(
            `Portolan tile proxy: ${response.status} ${response.statusText}`,
          )
        }
        return new Response('Upstream error', { status: response.status })
      }

      if (rest.endsWith('tiles.json')) {
        const body = (await response.json()) as { tiles?: string[] }
        if (Array.isArray(body.tiles)) {
          // absolute templates pointing at Barrelman become relative to
          // the feed directory; relative ones already are
          body.tiles = body.tiles.map((t) =>
            t.replace(/^https?:\/\/[^/]+\/tiles\/portolan\/[^/]+\//, ''),
          )
        }
        return new Response(JSON.stringify(body), {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
          },
        })
      }

      const data = await response.arrayBuffer()
      const isJson = rest.endsWith('.json')
      return new Response(data, {
        headers: {
          'Content-Type': isJson
            ? 'application/json'
            : response.headers.get('content-type') || 'application/x-protobuf',
          // pyramids rebuild on Barrelman's import cadence, so tiles get a
          // moderate TTL while the JSON manifests stay revalidated
          'Cache-Control': isJson ? 'no-cache' : 'public, max-age=3600',
        },
      })
    } catch (error) {
      logError('Portolan tile proxy error', error, { rest })
      return new Response('Proxy error', { status: 500 })
    }
  },
  {
    detail: {
      tags: ['Proxy'],
      summary: 'Proxy portolan transit tiles from Barrelman',
    },
  },
)

export default app
