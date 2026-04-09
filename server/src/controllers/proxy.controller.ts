import { Elysia } from 'elysia'
import { integrationManager } from '../services/integrations'
import {
  IntegrationCapabilityId,
  IntegrationId,
} from '../types/integration.types'

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

// Proxy Barrelman tile requests (bicycle_ways, bicycle_routes, etc.)
// Forwards to Barrelman's /tiles endpoint with tileKey auth
app.get(
  '/barrelman/:source/:z/:x/:y',
  async ({ params }) => {
    try {
      const systemIntegration = integrationManager
        .getConfiguredIntegrations()
        .find((i) => i.integrationId === IntegrationId.BARRELMAN)

      if (!systemIntegration || !systemIntegration.config?.host) {
        return new Response('Barrelman not configured', { status: 501 })
      }

      const { host, tileKey } = systemIntegration.config as {
        host: string
        tileKey?: string
      }
      const { source, z, x, y } = params
      const tileUrl = new URL(`/tiles/${source}/${z}/${x}/${y}`, host)
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
          'Cache-Control': 'public, max-age=86400',
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

export default app
