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

    if (!systemIntegration || !systemIntegration.config?.apiKey && !systemIntegration.config?.accessToken) {
      return new Response(`${integrationId} not configured`, { status: 501 })
    }

    const apiKey = systemIntegration.config.apiKey || systemIntegration.config.accessToken
    const targetUrl = targetUrlFn(apiKey, params)

    const response = await fetch(targetUrl)

    if (!response.ok) {
      console.error(`${errorContext}: ${response.status} ${response.statusText}`)
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
app.get('/loom/:service/geo/:z/:x/:y', async ({ params }) => {
  const { service, z, x, y } = params

  try {
    // Construct the target URL
    const targetUrl = `https://loom.cs.uni-freiburg.de/tiles/${service}/geo/${z}/${x}/${y}.mvt`

    // Fetch the data from the target URL
    const response = await fetch(targetUrl)

    if (!response.ok) {
      throw new Error(
        `Failed to fetch from Loom: ${response.status} ${response.statusText}`,
      )
    }

    // Get response as ArrayBuffer (for binary data like MVT)
    const data = await response.arrayBuffer()

    // Return the response with appropriate headers
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
})

// Proxy Mapillary vector tiles with token from integration
app.get('/mapillary/:dataset/:version/:z/:x/:y', async ({ params }) => {
  return proxyTileRequest(
    IntegrationId.MAPILLARY,
    (accessToken, { dataset, version, z, x, y }) =>
      `https://tiles.mapillary.com/maps/vtp/${dataset}/${version}/${z}/${x}/${y}?access_token=${encodeURIComponent(accessToken)}`,
    params,
    'Mapillary',
  )
})

// Proxy Transitland route tiles with API key from integration
app.get('/transitland/routes/:z/:x/:y', async ({ params }) => {
  return proxyTileRequest(
    IntegrationId.TRANSITLAND,
    (apiKey, { z, x, y }) =>
      `https://transit.land/api/v2/tiles/routes/tiles/${z}/${x}/${y}.pbf?apikey=${encodeURIComponent(apiKey)}`,
    params,
    'Transitland routes',
  )
})

// Proxy Transitland stop tiles with API key from integration
app.get('/transitland/stops/:z/:x/:y', async ({ params }) => {
  return proxyTileRequest(
    IntegrationId.TRANSITLAND,
    (apiKey, { z, x, y }) =>
      `https://transit.land/api/v2/tiles/stops/tiles/${z}/${x}/${y}.pbf?apikey=${encodeURIComponent(apiKey)}`,
    params,
    'Transitland stops',
  )
})

export default app
