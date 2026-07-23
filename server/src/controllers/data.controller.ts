import { Elysia } from 'elysia'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const app = new Elysia({ prefix: '/data' })

// Resolve from the app root (cwd is /app/server in both dev and prod containers)
// rather than __dirname, which sits 2 levels deep in dev (src/controllers) but
// only 1 level deep in the prod bundle (dist), breaking a fixed relative path.
const dataDir = resolve(process.cwd(), 'data')

let timezonesCache: Buffer | null = null

app.get('/timezones.geojson', () => {
  if (!timezonesCache) {
    timezonesCache = readFileSync(resolve(dataDir, 'timezones.geojson'))
  }
  return new Response(timezonesCache, {
    headers: {
      'Content-Type': 'application/geo+json',
      'Cache-Control': 'public, max-age=604800',
    },
  })
})

let logoSvgCache: Buffer | null = null

app.get('/logo.svg', () => {
  if (!logoSvgCache) {
    logoSvgCache = readFileSync(resolve(dataDir, 'logo.svg'))
  }
  return new Response(logoSvgCache, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=604800',
    },
  })
})

let logoPngCache: Buffer | null = null

app.get('/logo.png', () => {
  if (!logoPngCache) {
    logoPngCache = readFileSync(resolve(dataDir, 'logo.png'))
  }
  return new Response(logoPngCache, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=604800',
    },
  })
})

export default app
