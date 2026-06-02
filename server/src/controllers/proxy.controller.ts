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

// Proxy GTFS-RT vehicle positions from Barrelman.
// Barrelman polls VehiclePositions feeds and serves enriched results;
// we pass the bbox query params through and return JSON.
app.get(
  '/transit/vehicles',
  async ({ query }) => {
    try {
      const systemIntegration = integrationManager
        .getConfiguredIntegrations()
        .find((i) => i.integrationId === IntegrationId.BARRELMAN)

      const config = systemIntegration?.config as
        | { host?: string; apiKey?: string }
        | undefined
      if (!config?.host) {
        return new Response('Barrelman not configured', { status: 501 })
      }

      const params = new URLSearchParams()
      for (const [k, v] of Object.entries(query)) {
        if (v) params.set(k, String(v))
      }

      const headers: Record<string, string> = {}
      if (config.apiKey) {
        headers['Authorization'] = `Bearer ${config.apiKey}`
      }

      const response = await fetch(
        `${config.host}/transit/vehicles?${params}`,
        { headers },
      )

      return new Response(await response.arrayBuffer(), {
        status: response.status,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
        },
      })
    } catch (error) {
      console.error('Transit vehicles proxy error:', error)
      return new Response('Proxy error', { status: 500 })
    }
  },
  {
    detail: {
      tags: ['Proxy'],
      summary: 'Proxy GTFS-RT vehicle positions from Barrelman',
    },
  },
)

// Proxy GTFS shape geometry from Barrelman (static, long-cached).
app.get(
  '/transit/shapes',
  async ({ query }) => {
    try {
      const systemIntegration = integrationManager
        .getConfiguredIntegrations()
        .find((i) => i.integrationId === IntegrationId.BARRELMAN)

      const config = systemIntegration?.config as
        | { host?: string; apiKey?: string }
        | undefined
      if (!config?.host) {
        return new Response('Barrelman not configured', { status: 501 })
      }

      const params = new URLSearchParams()
      for (const [k, v] of Object.entries(query)) {
        if (v) params.set(k, String(v))
      }

      const headers: Record<string, string> = {}
      if (config.apiKey) {
        headers['Authorization'] = `Bearer ${config.apiKey}`
      }

      const response = await fetch(
        `${config.host}/transit/shapes?${params}`,
        { headers },
      )

      return new Response(await response.arrayBuffer(), {
        status: response.status,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=86400',
        },
      })
    } catch (error) {
      console.error('Transit shapes proxy error:', error)
      return new Response('Proxy error', { status: 500 })
    }
  },
  {
    detail: {
      tags: ['Proxy'],
      summary: 'Proxy GTFS route shape geometry from Barrelman',
    },
  },
)

// Proxy route detail from Barrelman (semi-static, cached 1 hour).
app.get(
  '/transit/route-detail',
  async ({ query }) => {
    try {
      const systemIntegration = integrationManager
        .getConfiguredIntegrations()
        .find((i) => i.integrationId === IntegrationId.BARRELMAN)

      const config = systemIntegration?.config as
        | { host?: string; apiKey?: string }
        | undefined
      if (!config?.host) {
        return new Response('Barrelman not configured', { status: 501 })
      }

      const params = new URLSearchParams()
      for (const [k, v] of Object.entries(query)) {
        if (v) params.set(k, String(v))
      }

      const headers: Record<string, string> = {}
      if (config.apiKey) {
        headers['Authorization'] = `Bearer ${config.apiKey}`
      }

      const response = await fetch(
        `${config.host}/transit/route-detail?${params}`,
        { headers },
      )

      return new Response(await response.arrayBuffer(), {
        status: response.status,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=3600',
        },
      })
    } catch (error) {
      console.error('Transit route detail proxy error:', error)
      return new Response('Proxy error', { status: 500 })
    }
  },
  {
    detail: {
      tags: ['Proxy'],
      summary: 'Proxy transit route detail from Barrelman',
    },
  },
)

export default app
