import { Elysia } from 'elysia'

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

export default app
