/**
 * Tile proxy.
 *
 * Map tile sources are fetched by MapLibre itself, which means they can't
 * attach our auth header and are subject to the tile server's CORS policy.
 * These routes exist so those requests can go out from the server instead:
 * they strip CORS out of the equation and keep provider keys server-side.
 *
 * What is left here is the providers whose keys are genuinely secret: Loom,
 * Mapillary and Transitland hand out one account key, so it cannot reach a
 * browser and the request has to originate here.
 *
 * Barrelman's tiles used to be in this list and are not any more. It serves
 * them CORS-open and authenticates map libraries with a scoped, origin-locked
 * key on the URL, so nothing was being hidden — while proxying collapsed every
 * user onto this server's address, which is per-address rate limited upstream.
 * The browser fetches those directly; see `resolveBarrelmanTileConfig`.
 *
 * Ordinary data endpoints that happen to be served by another service are not
 * proxies either — they live in their own module (see transit, gbfs and
 * isochrone controllers, which all call Barrelman through
 * `services/barrelman.service.ts`).
 */

import { Elysia } from 'elysia'
import { integrationManager } from '../services/integrations'
import { IntegrationId } from '../types/integration.types'
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

export default app
