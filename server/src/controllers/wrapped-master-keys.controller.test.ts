/**
 * Endpoint tests for the passkey-PRF wrapped master key controller.
 *
 * The server treats these rows as opaque, so what matters is the envelope:
 * every route is authenticated, writes are scoped to the caller, and the upsert
 * defaults `wrapAlgo` rather than storing undefined.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { authMockModule, setAuthUser, resetAuth, TEST_USER } from '../test/auth-mock'
import { createDbMock } from '../test/db-mock'
import { createTestApp, req } from '../test/app'

const dbMock = createDbMock()
mock.module('../db', () => ({ db: dbMock.db }))
mock.module('../middleware/auth.middleware', () => authMockModule())

const wrappedKeys = (await import('./wrapped-master-keys.controller')).default
const app = createTestApp(wrappedKeys)

const validSlot = {
  credentialId: 'cred-1',
  wrappedKm: 'wrapped-key-material',
  slotSignature: 'signature',
}

beforeEach(() => {
  resetAuth()
  dbMock.reset()
})

describe('auth gating', () => {
  const routes = [
    ['get', '/users/me/wrapped-keys'],
    ['post', '/users/me/wrapped-keys'],
    ['delete', '/users/me/wrapped-keys/cred-1'],
    ['post', '/users/me/wrapped-keys/cred-1/used'],
  ] as const

  for (const [method, path] of routes) {
    test(`${method.toUpperCase()} ${path} rejects an unauthenticated caller`, async () => {
      setAuthUser(null)

      const res = await req(app)[method](path, { body: validSlot })

      expect(res.status).toBe(401)
    })
  }

  test('no statement is issued for an unauthenticated request', async () => {
    setAuthUser(null)

    await req(app).get('/users/me/wrapped-keys')

    expect(dbMock.selectCount).toBe(0)
  })
})

describe('GET /users/me/wrapped-keys', () => {
  test('returns the caller’s slots', async () => {
    dbMock.queueSelect([
      { credentialId: 'cred-1', wrappedKm: 'k1' },
      { credentialId: 'cred-2', wrappedKm: 'k2' },
    ])

    const res = await req(app).get('/users/me/wrapped-keys')

    expect(res.status).toBe(200)
    expect(res.body.slots).toHaveLength(2)
  })

  test('returns an empty list when the user has no slots', async () => {
    dbMock.queueSelect([])

    const res = await req(app).get('/users/me/wrapped-keys')

    expect(res.status).toBe(200)
    expect(res.body.slots).toEqual([])
  })
})

describe('POST /users/me/wrapped-keys', () => {
  test('creates the slot against the caller’s user id and answers 201', async () => {
    const res = await req(app).post('/users/me/wrapped-keys', { body: validSlot })

    expect(res.status).toBe(201)
    expect(res.body).toEqual({ success: true })
    expect(dbMock.inserted[0]).toMatchObject({
      userId: TEST_USER.id,
      credentialId: 'cred-1',
      wrappedKm: 'wrapped-key-material',
      slotSignature: 'signature',
    })
  })

  test('defaults wrapAlgo when the client omits it', async () => {
    await req(app).post('/users/me/wrapped-keys', { body: validSlot })

    expect((dbMock.inserted[0] as any).wrapAlgo).toBe('aes-256-gcm-prf-v1')
  })

  test('honours an explicit wrapAlgo', async () => {
    await req(app).post('/users/me/wrapped-keys', {
      body: { ...validSlot, wrapAlgo: 'xchacha20-poly1305-v2' },
    })

    expect((dbMock.inserted[0] as any).wrapAlgo).toBe('xchacha20-poly1305-v2')
  })

  test('re-posting a credential updates the slot instead of duplicating it', async () => {
    await req(app).post('/users/me/wrapped-keys', {
      body: { ...validSlot, wrappedKm: 'rotated' },
    })

    expect(dbMock.conflictUpdates[0]).toMatchObject({
      wrappedKm: 'rotated',
      slotSignature: 'signature',
    })
  })

  test('the conflict path also defaults wrapAlgo', async () => {
    await req(app).post('/users/me/wrapped-keys', { body: validSlot })

    expect((dbMock.conflictUpdates[0] as any).wrapAlgo).toBe('aes-256-gcm-prf-v1')
  })

  for (const missing of ['credentialId', 'wrappedKm', 'slotSignature'] as const) {
    test(`422s when ${missing} is missing`, async () => {
      const body: Record<string, string> = { ...validSlot }
      delete body[missing]

      const res = await req(app).post('/users/me/wrapped-keys', { body })

      expect(res.status).toBe(422)
      expect(dbMock.insertCount).toBe(0)
    })
  }
})

describe('DELETE /users/me/wrapped-keys/:credentialId', () => {
  test('deletes the slot', async () => {
    const res = await req(app).delete('/users/me/wrapped-keys/cred-1')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    expect(dbMock.deleteCount).toBe(1)
  })

  test('reports success even when nothing matched (idempotent delete)', async () => {
    const res = await req(app).delete('/users/me/wrapped-keys/never-existed')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
  })
})

describe('POST /users/me/wrapped-keys/:credentialId/used', () => {
  test('stamps lastUsedAt', async () => {
    const res = await req(app).post('/users/me/wrapped-keys/cred-1/used')

    expect(res.status).toBe(200)
    expect(dbMock.updateCount).toBe(1)
    expect((dbMock.updated[0] as any).lastUsedAt).toBeInstanceOf(Date)
  })

  test('touches only lastUsedAt, never the key material', async () => {
    await req(app).post('/users/me/wrapped-keys/cred-1/used')

    expect(Object.keys(dbMock.updated[0] as object)).toEqual(['lastUsedAt'])
  })
})
