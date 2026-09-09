/**
 * Endpoint tests for the directions controller.
 *
 * Three distinct surfaces: trip planning (schema validation plus the
 * departure-before-arrival rule), a pure `/validate` endpoint that reports
 * problems as a payload rather than a status code, and the persisted trip
 * snapshots — which are deliberately unauthenticated, using an unguessable
 * capability token as the access control, with a size cap and a 30-day TTL.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { createDbMock } from '../test/db-mock'
import { createTestApp, req } from '../test/app'

const planTrip = mock(async (_request: any) => ({
  trips: [{ id: 'trip-1', mode: 'multi' }],
}))

mock.module('../services/trip.service', () => ({
  multimodalTripService: { planTrip },
}))

const dbMock = createDbMock()
mock.module('../db', () => ({ db: dbMock.db }))

mock.module('../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
  logError: () => {},
  logWarn: () => {},
}))

const directions = (await import('./directions.controller')).default
const app = createTestApp(directions)

const waypoints = [
  { location: { lat: 35.2, lng: -80.8 }, type: 'origin' },
  { location: { lat: 35.3, lng: -80.9 }, type: 'destination' },
]

beforeEach(() => {
  dbMock.reset()
  planTrip.mockClear()
  planTrip.mockImplementation(async () => ({ trips: [{ id: 'trip-1', mode: 'multi' }] }))
})

describe('POST /directions', () => {
  test('plans a trip from two waypoints', async () => {
    const res = await req(app).post('/directions', { body: { waypoints } })

    expect(res.status).toBe(200)
    expect(res.body.trips).toHaveLength(1)
    expect(planTrip.mock.calls[0][0].waypoints).toHaveLength(2)
  })

  test('422s with fewer than two waypoints', async () => {
    const res = await req(app).post('/directions', {
      body: { waypoints: [waypoints[0]] },
    })

    expect(res.status).toBe(422)
    expect(planTrip).not.toHaveBeenCalled()
  })

  test('422s on an unknown waypoint type', async () => {
    const res = await req(app).post('/directions', {
      body: {
        waypoints: [{ location: { lat: 1, lng: 2 }, type: 'layover' }, waypoints[1]],
      },
    })

    expect(res.status).toBe(422)
  })

  test('422s on an unknown travel mode', async () => {
    const res = await req(app).post('/directions', {
      body: { waypoints, selectedMode: 'teleport' },
    })

    expect(res.status).toBe(422)
  })

  test('422s on an unknown sort preference', async () => {
    const res = await req(app).post('/directions', {
      body: { waypoints, sortPreference: 'prettiest' },
    })

    expect(res.status).toBe(422)
  })

  test('422s on a routing preference outside its 0–1 range', async () => {
    const res = await req(app).post('/directions', {
      body: { waypoints, routingPreferences: { safetyVsSpeed: 5 } },
    })

    expect(res.status).toBe(422)
  })

  test('422s on an unsupported vehicle type', async () => {
    const res = await req(app).post('/directions', {
      body: { waypoints, availableVehicles: [{ id: 'v1', type: 'hovercraft' }] },
    })

    expect(res.status).toBe(422)
  })

  test('generates a requestId and timestamp when the client omits them', async () => {
    await req(app).post('/directions', { body: { waypoints } })

    const request = planTrip.mock.calls[0][0]
    expect(request.requestId).toMatch(/^trip-/)
    expect(new Date(request.timestamp).toISOString()).toBe(request.timestamp)
  })

  test('honours a client-supplied requestId', async () => {
    await req(app).post('/directions', {
      body: { waypoints, requestId: 'client-req-1' },
    })

    expect(planTrip.mock.calls[0][0].requestId).toBe('client-req-1')
  })

  test('resolves the language from the request', async () => {
    await req(app).post('/directions', {
      body: { waypoints },
      headers: { 'accept-language': 'es-ES' },
    })

    expect(planTrip.mock.calls[0][0].language).toBe('es-ES')
  })

  test('passes vehicles and access points through', async () => {
    await req(app).post('/directions', {
      body: {
        waypoints,
        availableVehicles: [
          { id: 'v1', type: 'car', energyType: 'electric', location: { lat: 1, lng: 2 } },
        ],
        knownAccessPoints: [{ osmId: 'node/1', code: 'A' }],
      },
    })

    const request = planTrip.mock.calls[0][0]
    expect(request.availableVehicles[0]).toMatchObject({
      id: 'v1',
      type: 'car',
      energyType: 'electric',
    })
    expect(request.knownAccessPoints).toHaveLength(1)
  })

  test('errors when departure is not before arrival', async () => {
    const res = await req(app).post('/directions', {
      body: {
        waypoints,
        preferredDepartureTime: '2026-01-02T10:00:00Z',
        preferredArrivalTime: '2026-01-02T09:00:00Z',
      },
    })

    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(planTrip).not.toHaveBeenCalled()
  })

  test('surfaces a planning failure rather than returning an empty 200', async () => {
    planTrip.mockRejectedValueOnce(new Error('no route found'))

    const res = await req(app).post('/directions', { body: { waypoints } })

    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})

describe('POST /directions/validate', () => {
  test('reports a valid request', async () => {
    const res = await req(app).post('/directions/validate', { body: { waypoints } })

    expect(res.status).toBe(200)
    expect(res.body.valid).toBe(true)
    expect(res.body.errors).toBeUndefined()
  })

  test('never plans a trip', async () => {
    await req(app).post('/directions/validate', { body: { waypoints } })

    expect(planTrip).not.toHaveBeenCalled()
  })

  test('reports out-of-range latitude as an error payload, not a 4xx', async () => {
    const res = await req(app).post('/directions/validate', {
      body: {
        waypoints: [
          { location: { lat: 95, lng: -80.8 }, type: 'origin' },
          waypoints[1],
        ],
      },
    })

    expect(res.status).toBe(200)
    expect(res.body.valid).toBe(false)
    expect(res.body.errors[0]).toContain('latitude must be between')
  })

  test('reports out-of-range longitude', async () => {
    const res = await req(app).post('/directions/validate', {
      body: {
        waypoints: [
          { location: { lat: 35, lng: -200 }, type: 'origin' },
          waypoints[1],
        ],
      },
    })

    expect(res.body.valid).toBe(false)
    expect(res.body.errors[0]).toContain('longitude must be between')
  })

  test('reports departure after arrival', async () => {
    const res = await req(app).post('/directions/validate', {
      body: {
        waypoints,
        preferredDepartureTime: '2026-01-02T10:00:00Z',
        preferredArrivalTime: '2026-01-02T09:00:00Z',
      },
    })

    expect(res.body.valid).toBe(false)
    expect(res.body.errors).toContain('Departure time must be before arrival time')
  })

  test('warns — without failing — on a very short time window', async () => {
    const res = await req(app).post('/directions/validate', {
      body: {
        waypoints,
        preferredDepartureTime: '2026-01-02T09:00:00Z',
        preferredArrivalTime: '2026-01-02T09:00:30Z',
      },
    })

    expect(res.body.valid).toBe(true)
    expect(res.body.warnings[0]).toContain('Very short time window')
  })

  test('reports a negative maxWalkingDistance', async () => {
    const res = await req(app).post('/directions/validate', {
      body: { waypoints, routingPreferences: { maxWalkingDistance: -1 } },
    })

    // The schema also bounds this, so the request is rejected before the
    // handler's own check — either way it must not validate as OK.
    expect(res.body.valid ?? false).toBe(false)
  })

  test('collects several errors at once', async () => {
    const res = await req(app).post('/directions/validate', {
      body: {
        waypoints: [
          { location: { lat: 95, lng: -200 }, type: 'origin' },
          waypoints[1],
        ],
      },
    })

    expect(res.body.errors.length).toBeGreaterThan(1)
  })
})

describe('GET /directions/vehicle-types and /status', () => {
  test('lists the supported vehicle types', async () => {
    const res = await req(app).get('/directions/vehicle-types')

    expect(res.status).toBe(200)
    const types = res.body.vehicleTypes.map((v: any) => v.type)
    expect(types).toContain('car')
    expect(types).toContain('truck')
  })

  test('declares energy types per vehicle', async () => {
    const res = await req(app).get('/directions/vehicle-types')

    const car = res.body.vehicleTypes.find((v: any) => v.type === 'car')
    expect(car.supportedEnergyTypes).toEqual(['gas', 'electric', 'hybrid'])
  })

  test('status reports capabilities and limits', async () => {
    const res = await req(app).get('/directions/status')

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('operational')
    expect(res.body.capabilities.limits.maxWaypoints).toBe(10)
    expect(res.body.capabilities.supportedModes).toContain('transit')
  })

  test('both are reachable anonymously', async () => {
    expect((await req(app).get('/directions/status')).status).toBe(200)
    expect((await req(app).get('/directions/vehicle-types')).status).toBe(200)
  })
})

describe('POST /directions/trips — snapshot persistence', () => {
  const snapshot = { request: { waypoints }, trip: { id: 'trip-1' } }

  test('stores a snapshot and returns its token', async () => {
    const res = await req(app).post('/directions/trips', { body: snapshot })

    expect(res.status).toBe(200)
    expect(res.body.id).toMatch(/^[0-9a-f]{16}$/)
    expect(dbMock.inserted[0]).toMatchObject({ request: snapshot.request })
  })

  test('the token is random, not derived from the payload', async () => {
    const first = await req(app).post('/directions/trips', { body: snapshot })
    const second = await req(app).post('/directions/trips', { body: snapshot })

    // The unguessable token IS the access control for these rows.
    expect(first.body.id).not.toBe(second.body.id)
  })

  test('sets a 30-day expiry', async () => {
    const res = await req(app).post('/directions/trips', { body: snapshot })

    const ttl = new Date(res.body.expiresAt).getTime() - Date.now()
    expect(ttl).toBeGreaterThan(29 * 24 * 3600 * 1000)
    expect(ttl).toBeLessThanOrEqual(30 * 24 * 3600 * 1000)
  })

  test('413s on an oversized snapshot', async () => {
    const huge = { request: {}, trip: { blob: 'x'.repeat(1_600_000) } }

    const res = await req(app).post('/directions/trips', { body: huge })

    expect(res.status).toBe(413)
    expect(dbMock.insertCount).toBe(0)
  })

  test('accepts a snapshot with no trip payload', async () => {
    // Both fields are `t.Any()`, which does not require presence — the
    // snapshot is opaque to the server, so an absent trip is stored as-is
    // rather than rejected.
    const res = await req(app).post('/directions/trips', {
      body: { request: {} },
    })

    expect(res.status).toBe(200)
    expect(dbMock.insertCount).toBe(1)
  })

  test('is unauthenticated by design', async () => {
    const res = await req(app).post('/directions/trips', { body: snapshot })

    expect(res.status).toBe(200)
  })
})

describe('GET /directions/trips/:id', () => {
  const storedRow = () => ({
    id: 'abc123',
    request: { waypoints },
    trip: { id: 'trip-1' },
    createdAt: new Date('2026-01-01T00:00:00Z'),
    expiresAt: new Date(Date.now() + 3600_000),
  })

  test('returns the stored snapshot', async () => {
    dbMock.queueSelect([storedRow()])

    const res = await req(app).get('/directions/trips/abc123')

    expect(res.status).toBe(200)
    expect(res.body.id).toBe('abc123')
    expect(res.body.trip).toEqual({ id: 'trip-1' })
    expect(res.body.createdAt).toBe('2026-01-01T00:00:00.000Z')
  })

  test('404s for an unknown token', async () => {
    dbMock.queueSelect([])

    const res = await req(app).get('/directions/trips/nope')

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Trip snapshot not found')
  })

  test('404s and deletes an expired snapshot', async () => {
    dbMock.queueSelect([
      { ...storedRow(), expiresAt: new Date(Date.now() - 1000) },
    ])

    const res = await req(app).get('/directions/trips/abc123')

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Trip snapshot expired')
    expect(dbMock.deleteCount).toBe(1)
  })

  test('is unauthenticated so a shared trip link works cross-device', async () => {
    dbMock.queueSelect([storedRow()])

    const res = await req(app).get('/directions/trips/abc123')

    expect(res.status).toBe(200)
  })
})
