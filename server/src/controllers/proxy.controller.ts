import { Elysia } from 'elysia'
import { integrationManager } from '../services/integrations'
import {
  IntegrationCapabilityId,
  IntegrationId,
} from '../types/integration.types'

const app = new Elysia({ prefix: '/proxy' })

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
  const { dataset, version, z, x, y } = params

  try {
    // Try system-wide integration first
    const systemIntegration = integrationManager
      .getConfiguredIntegrations()
      .find((i) => i.integrationId === IntegrationId.MAPILLARY)

    if (!systemIntegration || !systemIntegration.config?.accessToken) {
      return new Response('Mapillary not configured', { status: 501 })
    }

    const token = systemIntegration.config.accessToken
    const targetUrl = `https://tiles.mapillary.com/maps/vtp/${dataset}/${version}/${z}/${x}/${y}?access_token=${encodeURIComponent(
      token,
    )}`

    const response = await fetch(targetUrl)

    if (!response.ok) {
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
    console.error('Mapillary proxy error:', error)
    return new Response('Proxy error', { status: 500 })
  }
})

// Proxy Transitland tiles with API key from integration
app.get('/transitland/routes/:z/:x/:y', async ({ params }) => {
  const { z, x, y } = params

  try {
    const systemIntegration = integrationManager
      .getConfiguredIntegrations()
      .find((i) => i.integrationId === IntegrationId.TRANSITLAND)

    if (!systemIntegration || !systemIntegration.config?.apiKey) {
      return new Response('Transitland not configured', { status: 501 })
    }

    const apiKey = systemIntegration.config.apiKey
    const targetUrl = `https://transit.land/api/v2/tiles/routes/tiles/${z}/${x}/${y}.pbf?apikey=${encodeURIComponent(
      apiKey,
    )}`

    const response = await fetch(targetUrl)

    if (!response.ok) {
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
    console.error('Transitland proxy error:', error)
    return new Response('Proxy error', { status: 500 })
  }
})

export default app
