/**
 * Endpoint tests for the vehicles controller.
 *
 * The service layer is mocked: these assert the HTTP contract — auth gating,
 * body/param validation, status codes, and that each route hands the right
 * arguments to the service and serializes the result as the client expects.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { authMockModule, setAuthUser, resetAuth, TEST_USER } from '../test/auth-mock'
import { createTestApp, req } from '../test/app'

// ── Service mock ──────────────────────────────────────────────────────────────

const vehicleRow = {
  id: 'veh-1',
  type: 'car',
  energyType: 'electric',
  name: 'Blue Car',
  isActive: true,
  lastKnownLat: 35.2,
  lastKnownLng: -80.8,
  locationSource: 'manual',
  locationUpdatedAt: new Date('2026-01-02T03:04:05Z'),
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
}

const getUserVehicles = mock(async () => [vehicleRow])
const createVehicle = mock(async () => vehicleRow)
const updateVehicle = mock(async () => vehicleRow as typeof vehicleRow | null)
const deleteVehicle = mock(async () => true)
const setActiveVehicle = mock(async () => vehicleRow as typeof vehicleRow | null)
const updateVehicleLocation = mock(async () => vehicleRow as typeof vehicleRow | null)

mock.module('../services/vehicle.service', () => ({
  getUserVehicles,
  createVehicle,
  updateVehicle,
  deleteVehicle,
  setActiveVehicle,
  updateVehicleLocation,
}))

mock.module('../middleware/auth.middleware', () => authMockModule())

const vehicles = (await import('./vehicle.controller')).default
const app = createTestApp(vehicles)

beforeEach(() => {
  resetAuth()
  getUserVehicles.mockClear()
  createVehicle.mockClear()
  updateVehicle.mockClear()
  deleteVehicle.mockClear()
  setActiveVehicle.mockClear()
  updateVehicleLocation.mockClear()
})

describe('auth gating', () => {
  // Every route is behind requireAuth. Driving each one with no identity also
  // proves the guard is actually wired up — an unguarded route would answer
  // 200 here instead of 401.
  const routes = [
    ['get', '/vehicles'],
    ['post', '/vehicles'],
    ['patch', '/vehicles/veh-1'],
    ['delete', '/vehicles/veh-1'],
    ['post', '/vehicles/veh-1/activate'],
    ['put', '/vehicles/veh-1/location'],
  ] as const

  for (const [method, path] of routes) {
    test(`${method.toUpperCase()} ${path} rejects an unauthenticated caller`, async () => {
      setAuthUser(null)

      const res = await req(app)[method](path, { body: {} })

      expect(res.status).toBe(401)
    })
  }

  test('no service call escapes an unauthenticated request', async () => {
    setAuthUser(null)

    await req(app).get('/vehicles')

    expect(getUserVehicles).not.toHaveBeenCalled()
  })
})

describe('GET /vehicles', () => {
  test('returns the caller’s vehicles, scoped to their user id', async () => {
    const res = await req(app).get('/vehicles')

    expect(res.status).toBe(200)
    expect(getUserVehicles).toHaveBeenCalledWith(TEST_USER.id)
    expect(res.body.vehicles).toHaveLength(1)
  })

  test('serializes lat/lng into a nested location and dates as ISO strings', async () => {
    const res = await req(app).get('/vehicles')

    expect(res.body.vehicles[0]).toEqual({
      id: 'veh-1',
      type: 'car',
      energyType: 'electric',
      name: 'Blue Car',
      isActive: true,
      lastKnownLocation: { lat: 35.2, lng: -80.8 },
      locationSource: 'manual',
      locationUpdatedAt: '2026-01-02T03:04:05.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    })
  })

  test('reports a null location when the vehicle has no coordinates', async () => {
    getUserVehicles.mockResolvedValueOnce([
      { ...vehicleRow, lastKnownLat: null, lastKnownLng: null },
    ] as any)

    const res = await req(app).get('/vehicles')

    expect(res.body.vehicles[0].lastKnownLocation).toBeNull()
  })
})

describe('POST /vehicles', () => {
  test('creates a vehicle for the caller', async () => {
    const res = await req(app).post('/vehicles', {
      body: { type: 'bike', name: 'Commuter' },
    })

    expect(res.status).toBe(200)
    expect(createVehicle).toHaveBeenCalledWith(TEST_USER.id, {
      type: 'bike',
      name: 'Commuter',
    })
    expect(res.body.vehicle.id).toBe('veh-1')
  })

  test('rejects a body with no type', async () => {
    const res = await req(app).post('/vehicles', { body: { name: 'No type' } })

    expect(res.status).toBe(422)
    expect(createVehicle).not.toHaveBeenCalled()
  })

  test('rejects a non-string type', async () => {
    const res = await req(app).post('/vehicles', { body: { type: 42 } })

    expect(res.status).toBe(422)
    expect(createVehicle).not.toHaveBeenCalled()
  })
})

describe('PATCH /vehicles/:id', () => {
  test('updates and returns the vehicle', async () => {
    const res = await req(app).patch('/vehicles/veh-1', { body: { name: 'Renamed' } })

    expect(res.status).toBe(200)
    expect(updateVehicle).toHaveBeenCalledWith(TEST_USER.id, 'veh-1', {
      name: 'Renamed',
    })
  })

  test('404s when the vehicle is not the caller’s', async () => {
    updateVehicle.mockResolvedValueOnce(null)

    const res = await req(app).patch('/vehicles/other', { body: { name: 'x' } })

    expect(res.status).toBe(404)
    expect(res.body.message).toBe('Vehicle not found')
  })

  test('accepts explicit nulls to clear optional fields', async () => {
    const res = await req(app).patch('/vehicles/veh-1', {
      body: { energyType: null, name: null },
    })

    expect(res.status).toBe(200)
    expect(updateVehicle).toHaveBeenCalledWith(TEST_USER.id, 'veh-1', {
      energyType: null,
      name: null,
    })
  })
})

describe('DELETE /vehicles/:id', () => {
  test('deletes the vehicle', async () => {
    const res = await req(app).delete('/vehicles/veh-1')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ deleted: true })
    expect(deleteVehicle).toHaveBeenCalledWith(TEST_USER.id, 'veh-1')
  })

  test('404s when there was nothing to delete', async () => {
    deleteVehicle.mockResolvedValueOnce(false)

    const res = await req(app).delete('/vehicles/missing')

    expect(res.status).toBe(404)
  })
})

describe('POST /vehicles/:id/activate', () => {
  test('activates the vehicle', async () => {
    const res = await req(app).post('/vehicles/veh-1/activate')

    expect(res.status).toBe(200)
    expect(setActiveVehicle).toHaveBeenCalledWith(TEST_USER.id, 'veh-1')
  })

  test('404s for an unknown vehicle', async () => {
    setActiveVehicle.mockResolvedValueOnce(null)

    const res = await req(app).post('/vehicles/missing/activate')

    expect(res.status).toBe(404)
  })
})

describe('PUT /vehicles/:id/location', () => {
  test('defaults the source to manual when omitted', async () => {
    const res = await req(app).put('/vehicles/veh-1/location', {
      body: { lat: 35.5, lng: -80.9 },
    })

    expect(res.status).toBe(200)
    expect(updateVehicleLocation).toHaveBeenCalledWith(
      TEST_USER.id,
      'veh-1',
      { lat: 35.5, lng: -80.9 },
      'manual',
    )
  })

  test('passes an explicit source through', async () => {
    await req(app).put('/vehicles/veh-1/location', {
      body: { lat: 1, lng: 2, source: 'tracker' },
    })

    expect(updateVehicleLocation.mock.calls[0][3]).toBe('tracker')
  })

  test('rejects a source outside the allowed set', async () => {
    const res = await req(app).put('/vehicles/veh-1/location', {
      body: { lat: 1, lng: 2, source: 'satellite' },
    })

    expect(res.status).toBe(422)
    expect(updateVehicleLocation).not.toHaveBeenCalled()
  })

  test('rejects coordinates sent as strings', async () => {
    const res = await req(app).put('/vehicles/veh-1/location', {
      body: { lat: '35.5', lng: '-80.9' },
    })

    expect(res.status).toBe(422)
    expect(updateVehicleLocation).not.toHaveBeenCalled()
  })

  test('404s for an unknown vehicle', async () => {
    updateVehicleLocation.mockResolvedValueOnce(null)

    const res = await req(app).put('/vehicles/missing/location', {
      body: { lat: 1, lng: 2 },
    })

    expect(res.status).toBe(404)
  })
})
