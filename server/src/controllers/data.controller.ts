import { Elysia } from 'elysia'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const app = new Elysia({ prefix: '/data' })

let timezonesCache: Buffer | null = null

app.get('/timezones.geojson', () => {
  if (!timezonesCache) {
    timezonesCache = readFileSync(resolve(__dirname, '../../data/timezones.geojson'))
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
    logoSvgCache = readFileSync(resolve(__dirname, '../../data/logo.svg'))
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
    logoPngCache = readFileSync(resolve(__dirname, '../../data/logo.png'))
  }
  return new Response(logoPngCache, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=604800',
    },
  })
})

export default app
