/**
 * Endpoint tests for the device wrap-secrets controller.
 *
 * Both routes are per-user rate limited with real in-memory buckets, so the
 * limiter is exercised here rather than mocked — the budgets are part of the
 * contract (a client that blows through them gets 429, not a 500).
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { authMockModule, setAuthUser, resetAuth, TEST_USER } from '../test/auth-mock'
import { createTestApp, req } from '../test/app'

const getOrCreateDeviceWrapSecret = mock(
  async (_userId: string, _deviceId: string) => 'wrap-secret-abc',
)
const rotateAllForUser = mock(async (_userId: string) => undefined)

mock.module('../services/device-wrap-secrets.service', () => ({
  getOrCreateDeviceWrapSecret,
  rotateAllForUser,
}))

mock.module('../middleware/auth.middleware', () => authMockModule())

const deviceWrapSecrets = (await import('./device-wrap-secrets.controller')).default
const app = createTestApp(deviceWrapSecrets)

const DEVICE_ID = 'device-abc123'

beforeEach(() => {
  resetAuth()
  getOrCreateDeviceWrapSecret.mockClear()
  rotateAllForUser.mockClear()
})

describe('auth gating', () => {
  test('GET wrap-secret rejects an unauthenticated caller', async () => {
    setAuthUser(null)

    const res = await req(app).get(`/users/me/devices/${DEVICE_ID}/wrap-secret`)

    expect(res.status).toBe(401)
    expect(getOrCreateDeviceWrapSecret).not.toHaveBeenCalled()
  })

  test('POST rotate rejects an unauthenticated caller', async () => {
    setAuthUser(null)

    const res = await req(app).post('/users/me/device-wrap-secrets/rotate')

    expect(res.status).toBe(401)
    expect(rotateAllForUser).not.toHaveBeenCalled()
  })
})

describe('GET /users/me/devices/:deviceId/wrap-secret', () => {
  test('returns the secret for the caller’s device', async () => {
    const res = await req(app).get(`/users/me/devices/${DEVICE_ID}/wrap-secret`)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ secret: 'wrap-secret-abc' })
    expect(getOrCreateDeviceWrapSecret).toHaveBeenCalledWith(TEST_USER.id, DEVICE_ID)
  })

  test('is scoped to the caller — the device id is never trusted alone', async () => {
    await req(app).get(`/users/me/devices/${DEVICE_ID}/wrap-secret`)

    expect(getOrCreateDeviceWrapSecret.mock.calls[0][0]).toBe(TEST_USER.id)
  })

  test('rejects a device id shorter than 8 characters', async () => {
    const res = await req(app).get('/users/me/devices/short/wrap-secret')

    expect(res.status).toBe(422)
    expect(getOrCreateDeviceWrapSecret).not.toHaveBeenCalled()
  })

  test('rejects a device id longer than 64 characters', async () => {
    const res = await req(app).get(`/users/me/devices/${'a'.repeat(65)}/wrap-secret`)

    expect(res.status).toBe(422)
    expect(getOrCreateDeviceWrapSecret).not.toHaveBeenCalled()
  })

  test('rejects a device id with characters outside [a-zA-Z0-9-]', async () => {
    const res = await req(app).get('/users/me/devices/device_abc123/wrap-secret')

    expect(res.status).toBe(422)
    expect(getOrCreateDeviceWrapSecret).not.toHaveBeenCalled()
  })
})

describe('POST /users/me/device-wrap-secrets/rotate', () => {
  test('rotates every wrap secret for the caller', async () => {
    const res = await req(app).post('/users/me/device-wrap-secrets/rotate')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(rotateAllForUser).toHaveBeenCalledWith(TEST_USER.id)
  })

  test('429s past the 10-per-minute rotation budget', async () => {
    // This user's bucket is untouched by the tests above, which rotate at most
    // once and under the default identity.
    setAuthUser({ ...TEST_USER, id: 'rate-limit-user' })

    const statuses: number[] = []
    for (let i = 0; i < 11; i++) {
      const res = await req(app).post('/users/me/device-wrap-secrets/rotate')
      statuses.push(res.status)
    }

    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(200))
    expect(statuses[10]).toBe(429)
  })

  test('the 429 carries a Retry-After header', async () => {
    setAuthUser({ ...TEST_USER, id: 'retry-after-user' })

    let last = await req(app).post('/users/me/device-wrap-secrets/rotate')
    for (let i = 0; i < 10 && last.status !== 429; i++) {
      last = await req(app).post('/users/me/device-wrap-secrets/rotate')
    }

    expect(last.status).toBe(429)
    expect(last.headers.get('retry-after')).toBe('60')
  })

  test('rate-limit buckets are per user, not global', async () => {
    setAuthUser({ ...TEST_USER, id: 'noisy-user' })
    for (let i = 0; i < 11; i++) {
      await req(app).post('/users/me/device-wrap-secrets/rotate')
    }

    setAuthUser({ ...TEST_USER, id: 'quiet-user' })
    const res = await req(app).post('/users/me/device-wrap-secrets/rotate')

    expect(res.status).toBe(200)
  })
})
