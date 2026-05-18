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

export default app
