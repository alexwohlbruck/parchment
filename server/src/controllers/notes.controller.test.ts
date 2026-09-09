/**
 * Endpoint tests for the OSM notes controller.
 *
 * The routes proxy the OSM API, so the contract worth pinning is the seam:
 * GeoJSON features are flattened into our note shape, upstream status codes are
 * passed through rather than collapsed to 500, and every write route refuses to
 * proceed without the caller's own OSM token.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import {
  authMockModule,
  setAuthUser,
  setHasPermission,
  resetAuth,
  TEST_USER,
} from '../test/auth-mock'
import { createAxiosMock, axiosError } from '../test/axios-mock'
import { createTestApp, req } from '../test/app'
import { IntegrationId } from '../types/integration.enums'

const http = createAxiosMock()
mock.module('axios', () => http.module)

let configuredIntegrations: unknown[] = [
  { integrationId: IntegrationId.OPENSTREETMAP_ACCOUNT, config: { accessToken: 'osm-token' } },
]
const getConfiguredIntegrations = mock(async (_userId: string) => configuredIntegrations)

mock.module('../services/integration.service', () => ({ getConfiguredIntegrations }))
mock.module('../config/osm.config', () => ({
  getOsmConfig: () => ({ apiBase: 'https://api.osm.test/api/0.6' }),
}))
mock.module('../middleware/auth.middleware', () => authMockModule())

const notes = (await import('./notes.controller')).default
const app = createTestApp(notes)

/** An OSM note as the API returns it — GeoJSON Feature with nested props. */
const noteFeature = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-80.8, 35.2] },
  properties: {
    id: 4242,
    status: 'open',
    date_created: '2026-01-01 00:00:00 UTC',
    closed_at: null,
    comments: [
      {
        date: '2026-01-01 00:00:00 UTC',
        uid: 7,
        user: 'mapper',
        action: 'opened',
        text: 'Pothole here',
      },
    ],
  },
}

beforeEach(() => {
  resetAuth()
  http.reset()
  configuredIntegrations = [
    { integrationId: IntegrationId.OPENSTREETMAP_ACCOUNT, config: { accessToken: 'osm-token' } },
  ]
  getConfiguredIntegrations.mockClear()
})

describe('GET /notes', () => {
  test('fetches notes in a bounding box without authentication', async () => {
    setAuthUser(null)
    http.get.mockResolvedValueOnce({ data: { features: [noteFeature] } })

    const res = await req(app).get('/notes', { query: { bbox: '-81,35,-80,36' } })

    expect(res.status).toBe(200)
    expect(http.get.mock.calls[0][0]).toBe('https://api.osm.test/api/0.6/notes.json')
  })

  test('flattens the GeoJSON feature into our note shape', async () => {
    http.get.mockResolvedValueOnce({ data: { features: [noteFeature] } })

    const res = await req(app).get('/notes', { query: { bbox: '-81,35,-80,36' } })

    expect(res.body[0]).toEqual({
      id: 4242,
      lat: 35.2,
      lng: -80.8,
      status: 'open',
      comments: [
        {
          date: '2026-01-01 00:00:00 UTC',
          uid: 7,
          user: 'mapper',
          action: 'opened',
          text: 'Pothole here',
        },
      ],
      createdAt: '2026-01-01 00:00:00 UTC',
      closedAt: null,
    })
  })

  test('prefers explicit lat/lon properties over the geometry coordinates', async () => {
    http.get.mockResolvedValueOnce({
      data: {
        features: [
          { ...noteFeature, properties: { ...noteFeature.properties, lat: 1, lon: 2 } },
        ],
      },
    })

    const res = await req(app).get('/notes', { query: { bbox: '-81,35,-80,36' } })

    expect(res.body[0].lat).toBe(1)
    expect(res.body[0].lng).toBe(2)
  })

  test('defaults limit to 100 and closed to 7 days', async () => {
    http.get.mockResolvedValueOnce({ data: { features: [] } })

    await req(app).get('/notes', { query: { bbox: '-81,35,-80,36' } })

    expect(http.get.mock.calls[0][1].params).toMatchObject({ limit: 100, closed: 7 })
  })

  test('passes explicit limit and closed through', async () => {
    http.get.mockResolvedValueOnce({ data: { features: [] } })

    await req(app).get('/notes', {
      query: { bbox: '-81,35,-80,36', limit: 5, closed: 0 },
    })

    expect(http.get.mock.calls[0][1].params).toMatchObject({ limit: 5, closed: 0 })
  })

  test('returns an empty array when OSM sends no features', async () => {
    http.get.mockResolvedValueOnce({ data: {} })

    const res = await req(app).get('/notes', { query: { bbox: '-81,35,-80,36' } })

    expect(res.body).toEqual([])
  })

  test('422s without a bbox', async () => {
    const res = await req(app).get('/notes')

    expect(res.status).toBe(422)
    expect(http.get).not.toHaveBeenCalled()
  })

  test('passes an upstream 400 through rather than reporting 500', async () => {
    http.get.mockRejectedValueOnce(axiosError(400, 'bbox too large'))

    const res = await req(app).get('/notes', { query: { bbox: '-180,-90,180,90' } })

    expect(res.status).toBe(400)
  })

  test('500s when the upstream error carries no status', async () => {
    http.get.mockRejectedValueOnce(new Error('socket hang up'))

    const res = await req(app).get('/notes', { query: { bbox: '-81,35,-80,36' } })

    expect(res.status).toBe(500)
  })

  test('503s when the OSM integration is not configured', async () => {
    http.get.mockRejectedValueOnce(new Error('OSM is not configured'))

    const res = await req(app).get('/notes', { query: { bbox: '-81,35,-80,36' } })

    expect(res.status).toBe(503)
  })
})

describe('GET /notes/:id', () => {
  test('fetches a single note', async () => {
    http.get.mockResolvedValueOnce({ data: noteFeature })

    const res = await req(app).get('/notes/4242')

    expect(res.status).toBe(200)
    expect(res.body.id).toBe(4242)
    expect(http.get.mock.calls[0][0]).toBe(
      'https://api.osm.test/api/0.6/notes/4242.json',
    )
  })

  test('422s on a non-numeric note id', async () => {
    const res = await req(app).get('/notes/abc')

    expect(res.status).toBe(422)
    expect(http.get).not.toHaveBeenCalled()
  })

  test('passes an upstream 404 through', async () => {
    http.get.mockRejectedValueOnce(axiosError(404, 'not found'))

    const res = await req(app).get('/notes/999999')

    expect(res.status).toBe(404)
  })
})

describe('write routes — permission and OSM token gating', () => {
  const writes = [
    ['/notes/create', { lat: 35.2, lng: -80.8, text: 'Pothole' }],
    ['/notes/4242/comment', { text: 'Still there' }],
    ['/notes/4242/close', { text: 'Fixed' }],
    ['/notes/4242/reopen', {}],
  ] as const

  for (const [path, body] of writes) {
    test(`POST ${path} rejects an unauthenticated caller`, async () => {
      setAuthUser(null)

      const res = await req(app).post(path, { body })

      expect(res.status).toBe(401)
      expect(http.post).not.toHaveBeenCalled()
    })

    test(`POST ${path} rejects a caller without notes:write`, async () => {
      setHasPermission(false)

      const res = await req(app).post(path, { body })

      expect(res.status).toBe(403)
      expect(http.post).not.toHaveBeenCalled()
    })

    test(`POST ${path} 403s when the user has no OSM account linked`, async () => {
      configuredIntegrations = []

      const res = await req(app).post(path, { body })

      expect(res.status).toBe(403)
      expect(res.body.message).toContain('No OSM integration configured')
      expect(http.post).not.toHaveBeenCalled()
    })
  }

  test('the OSM token is looked up for the calling user, not a fixed one', async () => {
    http.post.mockResolvedValueOnce({ data: noteFeature })

    await req(app).post('/notes/create', {
      body: { lat: 1, lng: 2, text: 'x' },
    })

    expect(getConfiguredIntegrations).toHaveBeenCalledWith(TEST_USER.id)
  })
})

describe('POST /notes/create', () => {
  test('creates a note with the caller’s bearer token', async () => {
    http.post.mockResolvedValueOnce({ data: noteFeature })

    const res = await req(app).post('/notes/create', {
      body: { lat: 35.2, lng: -80.8, text: 'Pothole' },
    })

    expect(res.status).toBe(200)
    const [url, payload, config] = http.post.mock.calls[0]
    expect(url).toBe('https://api.osm.test/api/0.6/notes.json')
    expect(payload).toBeNull()
    expect(config.params).toEqual({ lat: 35.2, lon: -80.8, text: 'Pothole' })
    expect(config.headers.Authorization).toBe('Bearer osm-token')
  })

  test('sends lng as OSM’s `lon` parameter', async () => {
    http.post.mockResolvedValueOnce({ data: noteFeature })

    await req(app).post('/notes/create', { body: { lat: 1, lng: 2, text: 'x' } })

    expect(http.post.mock.calls[0][2].params.lon).toBe(2)
  })

  test('422s when text is missing', async () => {
    const res = await req(app).post('/notes/create', { body: { lat: 1, lng: 2 } })

    expect(res.status).toBe(422)
    expect(http.post).not.toHaveBeenCalled()
  })

  test('422s on non-numeric coordinates', async () => {
    const res = await req(app).post('/notes/create', {
      body: { lat: 'north', lng: 2, text: 'x' },
    })

    expect(res.status).toBe(422)
  })
})

describe('POST /notes/:id/comment', () => {
  test('posts the comment to the note', async () => {
    http.post.mockResolvedValueOnce({ data: noteFeature })

    const res = await req(app).post('/notes/4242/comment', {
      body: { text: 'Still there' },
    })

    expect(res.status).toBe(200)
    expect(http.post.mock.calls[0][0]).toBe(
      'https://api.osm.test/api/0.6/notes/4242/comment.json',
    )
    expect(http.post.mock.calls[0][2].params).toEqual({ text: 'Still there' })
  })

  test('422s without comment text', async () => {
    const res = await req(app).post('/notes/4242/comment', { body: {} })

    expect(res.status).toBe(422)
  })

  test('passes an upstream 409 (already closed) through', async () => {
    http.post.mockRejectedValueOnce(axiosError(409, 'note is closed'))

    const res = await req(app).post('/notes/4242/comment', { body: { text: 'x' } })

    expect(res.status).toBe(409)
  })
})

describe('POST /notes/:id/close and /reopen', () => {
  test('close sends the optional text when provided', async () => {
    http.post.mockResolvedValueOnce({ data: noteFeature })

    await req(app).post('/notes/4242/close', { body: { text: 'Fixed' } })

    expect(http.post.mock.calls[0][0]).toBe(
      'https://api.osm.test/api/0.6/notes/4242/close.json',
    )
    expect(http.post.mock.calls[0][2].params).toEqual({ text: 'Fixed' })
  })

  test('close omits params entirely when no text is given', async () => {
    http.post.mockResolvedValueOnce({ data: noteFeature })

    await req(app).post('/notes/4242/close', { body: {} })

    expect(http.post.mock.calls[0][2].params).toBeUndefined()
  })

  test('reopen targets the reopen endpoint', async () => {
    http.post.mockResolvedValueOnce({ data: noteFeature })

    await req(app).post('/notes/4242/reopen', { body: {} })

    expect(http.post.mock.calls[0][0]).toBe(
      'https://api.osm.test/api/0.6/notes/4242/reopen.json',
    )
  })

  test('422s on a non-numeric note id', async () => {
    const res = await req(app).post('/notes/abc/close', { body: {} })

    expect(res.status).toBe(422)
    expect(http.post).not.toHaveBeenCalled()
  })
})
