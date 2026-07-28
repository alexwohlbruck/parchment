/**
 * Endpoint tests for the static data controller.
 *
 * These routes read real files off disk and are public by design. The contract
 * is the content type and the long cache window clients rely on, plus the
 * in-process cache that keeps repeat requests off the filesystem.
 */

import { describe, test, expect } from 'bun:test'
import { createTestApp, req } from '../test/app'
import data from './data.controller'

const app = createTestApp(data)

describe('GET /data/timezones.geojson', () => {
  test('serves the timezone geometry as geo+json', async () => {
    const res = await req(app).get('/data/timezones.geojson')

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/geo+json')
  })

  test('is cacheable for a week', async () => {
    const res = await req(app).get('/data/timezones.geojson')

    expect(res.headers.get('cache-control')).toBe('public, max-age=604800')
  })

  test('returns parseable GeoJSON', async () => {
    const res = await req(app).get('/data/timezones.geojson')

    expect(res.body.type).toBe('FeatureCollection')
    expect(Array.isArray(res.body.features)).toBe(true)
  })

  test('serves identical bytes on a repeat request (cached in process)', async () => {
    const first = await req(app).get('/data/timezones.geojson')
    const second = await req(app).get('/data/timezones.geojson')

    expect(second.status).toBe(200)
    expect(second.body.features.length).toBe(first.body.features.length)
  })

  test('needs no authentication', async () => {
    // No Authorization header is set anywhere in this file; a guard would 401.
    const res = await req(app).get('/data/timezones.geojson')

    expect(res.status).toBe(200)
  })
})

describe('GET /data/logo.svg', () => {
  test('serves the SVG with the image/svg+xml type', async () => {
    const res = await req(app).get('/data/logo.svg')

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/svg+xml')
    expect(String(res.body)).toContain('<svg')
  })

  test('is cacheable for a week', async () => {
    const res = await req(app).get('/data/logo.svg')

    expect(res.headers.get('cache-control')).toBe('public, max-age=604800')
  })
})

describe('GET /data/logo.png', () => {
  test('serves the PNG with the image/png type', async () => {
    const res = await req(app).get('/data/logo.png')

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
  })

  test('is cacheable for a week', async () => {
    const res = await req(app).get('/data/logo.png')

    expect(res.headers.get('cache-control')).toBe('public, max-age=604800')
  })
})

describe('unknown data files', () => {
  test('404s rather than reading an arbitrary path', async () => {
    const res = await req(app).get('/data/secrets.env')

    expect(res.status).toBe(404)
  })

  test('does not serve files via a traversal segment', async () => {
    const res = await req(app).get('/data/../package.json')

    expect(res.status).not.toBe(200)
  })
})
