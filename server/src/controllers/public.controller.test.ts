/**
 * Endpoint tests for the public (unauthenticated) token resolvers.
 *
 * This is the only surface reachable with no session at all, so the tests below
 * lean on two things: an unknown token must 404 rather than leak existence, and
 * the response must carry exactly the allowlisted fields — a service that later
 * returns extra columns must not silently widen what a public link exposes.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { createTestApp, req } from '../test/app'

const collectionRow = {
  id: 'col-1',
  userId: 'owner-1',
  scheme: 'server',
  metadataEncrypted: 'cipher',
  metadataKeyVersion: 2,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  publicRole: 'viewer',
  // Fields the resolver must NOT pass through.
  publicLinkToken: 'secret-token',
  internalNotes: 'server-private',
}

const routeRow = {
  id: 'route-1',
  userId: 'owner-1',
  mode: 'cycling',
  scheme: 'server',
  metadataEncrypted: 'cipher',
  metadataKeyVersion: 1,
  body: { waypoints: [] },
  distance: 1200,
  duration: 600,
  elevationGain: 30,
  elevationLoss: 25,
  publicRole: 'viewer',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  publicLinkToken: 'secret-token',
}

const getPublicCollectionByToken = mock(async (_token: string) => ({
  collection: collectionRow,
  bookmarks: [{ id: 'bm-1' }],
}) as unknown)

const getPublicRouteByToken = mock(async (_token: string) => routeRow as unknown)

mock.module('../services/library/collections.service', () => ({
  getPublicCollectionByToken,
}))
mock.module('../services/library/routes.service', () => ({
  getPublicRouteByToken,
}))

const publicController = (await import('./public.controller')).default
const app = createTestApp(publicController)

beforeEach(() => {
  getPublicCollectionByToken.mockClear()
  getPublicCollectionByToken.mockImplementation(async () => ({
    collection: collectionRow,
    bookmarks: [{ id: 'bm-1' }],
  }))
  getPublicRouteByToken.mockClear()
  getPublicRouteByToken.mockImplementation(async () => routeRow)
})

describe('GET /public/collections/:token', () => {
  test('resolves a valid token with no authentication', async () => {
    const res = await req(app).get('/public/collections/tok-1')

    expect(res.status).toBe(200)
    expect(getPublicCollectionByToken).toHaveBeenCalledWith('tok-1')
    expect(res.body.collection.id).toBe('col-1')
    expect(res.body.bookmarks).toEqual([{ id: 'bm-1' }])
  })

  test('exposes exactly the allowlisted collection fields', async () => {
    const res = await req(app).get('/public/collections/tok-1')

    expect(Object.keys(res.body.collection).sort()).toEqual([
      'createdAt',
      'id',
      'metadataEncrypted',
      'metadataKeyVersion',
      'publicRole',
      'scheme',
      'updatedAt',
      'userId',
    ])
  })

  test('never echoes the public-link token back', async () => {
    const res = await req(app).get('/public/collections/tok-1')

    expect(JSON.stringify(res.body)).not.toContain('secret-token')
  })

  test('404s for an unknown or revoked token', async () => {
    getPublicCollectionByToken.mockResolvedValueOnce(null)

    const res = await req(app).get('/public/collections/revoked')

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Resource not found' })
  })

  test('the 404 body reveals nothing about why the token failed', async () => {
    getPublicCollectionByToken.mockResolvedValueOnce(null)

    const res = await req(app).get('/public/collections/never-existed')

    expect(res.body).toEqual({ error: 'Resource not found' })
  })
})

describe('GET /public/routes/:token', () => {
  test('resolves a valid token with no authentication', async () => {
    const res = await req(app).get('/public/routes/tok-2')

    expect(res.status).toBe(200)
    expect(getPublicRouteByToken).toHaveBeenCalledWith('tok-2')
    expect(res.body.route.id).toBe('route-1')
  })

  test('exposes exactly the allowlisted route fields', async () => {
    const res = await req(app).get('/public/routes/tok-2')

    expect(Object.keys(res.body.route).sort()).toEqual([
      'body',
      'createdAt',
      'distance',
      'duration',
      'elevationGain',
      'elevationLoss',
      'id',
      'metadataKeyVersion',
      'metadataEncrypted',
      'mode',
      'publicRole',
      'scheme',
      'updatedAt',
      'userId',
    ].sort())
  })

  test('passes the cleartext body through for the shared view to render', async () => {
    const res = await req(app).get('/public/routes/tok-2')

    expect(res.body.route.body).toEqual({ waypoints: [] })
  })

  test('404s for an unknown token', async () => {
    getPublicRouteByToken.mockResolvedValueOnce(null)

    const res = await req(app).get('/public/routes/revoked')

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Resource not found' })
  })
})

describe('per-IP rate limiting', () => {
  test('429s past 120 resolutions a minute from one IP', async () => {
    const headers = { 'x-forwarded-for': '203.0.113.10' }

    let last = { status: 200 } as { status: number }
    for (let i = 0; i < 121; i++) {
      last = await req(app).get('/public/collections/tok-1', { headers })
    }

    expect(last.status).toBe(429)
  })

  test('the budget is per IP, so another client is unaffected', async () => {
    const noisy = { 'x-forwarded-for': '203.0.113.20' }
    for (let i = 0; i < 121; i++) {
      await req(app).get('/public/collections/tok-1', { headers: noisy })
    }

    const res = await req(app).get('/public/collections/tok-1', {
      headers: { 'x-forwarded-for': '203.0.113.21' },
    })

    expect(res.status).toBe(200)
  })

  test('the limit spans both resolvers — they share one IP bucket', async () => {
    const headers = { 'x-forwarded-for': '203.0.113.30' }
    for (let i = 0; i < 121; i++) {
      await req(app).get('/public/collections/tok-1', { headers })
    }

    const res = await req(app).get('/public/routes/tok-2', { headers })

    expect(res.status).toBe(429)
  })
})
