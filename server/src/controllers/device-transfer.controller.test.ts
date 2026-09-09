/**
 * Endpoint tests for the device-to-device transfer relay.
 *
 * The server is pure plumbing for an E2EE-sealed seed, so the value is in the
 * state machine around it: the upload is a single conditional UPDATE (so two
 * racing senders can't both win), the fetch is one-shot, and each failure mode
 * gets its own status code — 404 unknown, 403 another user's, 410 consumed or
 * expired, 425 not yet uploaded, 409 already uploaded.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { authMockModule, setAuthUser, resetAuth, TEST_USER } from '../test/auth-mock'
import { createDbMock } from '../test/db-mock'
import { createTestApp, req } from '../test/app'

const dbMock = createDbMock()
mock.module('../db', () => ({ db: dbMock.db }))
mock.module('../util', () => ({ generateId: () => 'session-generated' }))
mock.module('../middleware/auth.middleware', () => authMockModule())

const deviceTransfer = (await import('./device-transfer.controller')).default
const app = createTestApp(deviceTransfer)

const future = () => new Date(Date.now() + 30_000)
const past = () => new Date(Date.now() - 1_000)

/** A live session owned by the test user, awaiting the sender's upload. */
const pendingSession = () => ({
  id: 'session-1',
  userId: TEST_USER.id,
  receiverEphemeralPub: 'receiver-pub',
  senderEphemeralPub: null,
  sealedSeed: null,
  senderSignature: null,
  consumed: false,
  createdAt: new Date(),
  expiresAt: future(),
})

const uploadedSession = () => ({
  ...pendingSession(),
  senderEphemeralPub: 'sender-pub',
  sealedSeed: 'sealed',
  senderSignature: 'sig',
})

const uploadBody = {
  senderEphemeralPub: 'sender-pub',
  sealedSeed: 'sealed',
  senderSignature: 'sig',
}

beforeEach(() => {
  resetAuth()
  dbMock.reset()
})

describe('auth gating', () => {
  const routes = [
    ['post', '/device-transfer'],
    ['post', '/device-transfer/session-1/upload'],
    ['get', '/device-transfer/session-1'],
    ['delete', '/device-transfer/session-1'],
  ] as const

  for (const [method, path] of routes) {
    test(`${method.toUpperCase()} ${path} rejects an unauthenticated caller`, async () => {
      setAuthUser(null)

      const res = await req(app)[method](path, {
        body: { receiverEphemeralPub: 'pub', ...uploadBody },
      })

      expect(res.status).toBe(401)
    })
  }
})

describe('POST /device-transfer', () => {
  test('creates a session and returns its id and expiry', async () => {
    dbMock.queueSelect([{ count: 0 }])

    const res = await req(app).post('/device-transfer', {
      body: { receiverEphemeralPub: 'receiver-pub' },
    })

    expect(res.status).toBe(200)
    expect(res.body.sessionId).toBe('session-generated')
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now())
  })

  test('stores the session against the caller, unconsumed', async () => {
    dbMock.queueSelect([{ count: 0 }])

    await req(app).post('/device-transfer', {
      body: { receiverEphemeralPub: 'receiver-pub' },
    })

    expect(dbMock.inserted[0]).toMatchObject({
      userId: TEST_USER.id,
      receiverEphemeralPub: 'receiver-pub',
      consumed: false,
    })
  })

  test('gives the session a 60 second lifetime', async () => {
    dbMock.queueSelect([{ count: 0 }])

    const res = await req(app).post('/device-transfer', {
      body: { receiverEphemeralPub: 'receiver-pub' },
    })

    const ttl = new Date(res.body.expiresAt).getTime() - Date.now()
    expect(ttl).toBeGreaterThan(50_000)
    expect(ttl).toBeLessThanOrEqual(60_000)
  })

  test('429s past 3 sessions in the rolling hour', async () => {
    dbMock.queueSelect([{ count: 3 }])

    const res = await req(app).post('/device-transfer', {
      body: { receiverEphemeralPub: 'receiver-pub' },
    })

    expect(res.status).toBe(429)
    expect(dbMock.insertCount).toBe(0)
  })

  test('allows the third session', async () => {
    dbMock.queueSelect([{ count: 2 }])

    const res = await req(app).post('/device-transfer', {
      body: { receiverEphemeralPub: 'receiver-pub' },
    })

    expect(res.status).toBe(200)
  })

  test('422s without the receiver public key', async () => {
    const res = await req(app).post('/device-transfer', { body: {} })

    expect(res.status).toBe(422)
    expect(dbMock.insertCount).toBe(0)
  })
})

describe('POST /device-transfer/:id/upload', () => {
  test('succeeds when the conditional update matches the session', async () => {
    dbMock.queueReturning([{ id: 'session-1' }])

    const res = await req(app).post('/device-transfer/session-1/upload', {
      body: uploadBody,
    })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    expect(dbMock.updated[0]).toMatchObject({
      senderEphemeralPub: 'sender-pub',
      sealedSeed: 'sealed',
      senderSignature: 'sig',
    })
  })

  test('does not read the session at all on the success path', async () => {
    dbMock.queueReturning([{ id: 'session-1' }])

    await req(app).post('/device-transfer/session-1/upload', { body: uploadBody })

    // The classification SELECT only runs when the UPDATE matched nothing.
    expect(dbMock.selectCount).toBe(0)
  })

  test('404s when the session does not exist', async () => {
    dbMock.queueReturning([])
    dbMock.queueSelect([])

    const res = await req(app).post('/device-transfer/missing/upload', {
      body: uploadBody,
    })

    expect(res.status).toBe(404)
  })

  test('403s when the session belongs to another user', async () => {
    dbMock.queueReturning([])
    dbMock.queueSelect([{ ...pendingSession(), userId: 'someone-else' }])

    const res = await req(app).post('/device-transfer/session-1/upload', {
      body: uploadBody,
    })

    expect(res.status).toBe(403)
  })

  test('410s when the session was already consumed', async () => {
    dbMock.queueReturning([])
    dbMock.queueSelect([{ ...pendingSession(), consumed: true }])

    const res = await req(app).post('/device-transfer/session-1/upload', {
      body: uploadBody,
    })

    expect(res.status).toBe(410)
    expect(res.body.message).toBe('Session already consumed')
  })

  test('410s when the session expired', async () => {
    dbMock.queueReturning([])
    dbMock.queueSelect([{ ...pendingSession(), expiresAt: past() }])

    const res = await req(app).post('/device-transfer/session-1/upload', {
      body: uploadBody,
    })

    expect(res.status).toBe(410)
    expect(res.body.message).toBe('Session expired')
  })

  test('409s when a payload is already present — the racing sender lost', async () => {
    dbMock.queueReturning([])
    dbMock.queueSelect([uploadedSession()])

    const res = await req(app).post('/device-transfer/session-1/upload', {
      body: uploadBody,
    })

    expect(res.status).toBe(409)
    expect(res.body.message).toBe('Payload already uploaded')
  })

  for (const field of ['senderEphemeralPub', 'sealedSeed', 'senderSignature'] as const) {
    test(`422s when ${field} is missing`, async () => {
      const body: Record<string, string> = { ...uploadBody }
      delete body[field]

      const res = await req(app).post('/device-transfer/session-1/upload', { body })

      expect(res.status).toBe(422)
      expect(dbMock.updateCount).toBe(0)
    })
  }
})

describe('GET /device-transfer/:id', () => {
  test('returns the sealed payload and marks the session consumed', async () => {
    dbMock.queueSelect([uploadedSession()])
    dbMock.queueReturning([{ id: 'session-1' }])

    const res = await req(app).get('/device-transfer/session-1')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      sessionId: 'session-1',
      receiverEphemeralPub: 'receiver-pub',
      senderEphemeralPub: 'sender-pub',
      sealedSeed: 'sealed',
      senderSignature: 'sig',
    })
    expect(dbMock.updated[0]).toEqual({ consumed: true })
  })

  test('425s while the sender has not uploaded yet, so the receiver polls', async () => {
    dbMock.queueSelect([pendingSession()])

    const res = await req(app).get('/device-transfer/session-1')

    expect(res.status).toBe(425)
    expect(dbMock.updateCount).toBe(0)
  })

  test('404s for an unknown session', async () => {
    dbMock.queueSelect([])

    const res = await req(app).get('/device-transfer/missing')

    expect(res.status).toBe(404)
  })

  test('403s for another user’s session', async () => {
    dbMock.queueSelect([{ ...uploadedSession(), userId: 'someone-else' }])

    const res = await req(app).get('/device-transfer/session-1')

    expect(res.status).toBe(403)
  })

  test('410s for an already-consumed session', async () => {
    dbMock.queueSelect([{ ...uploadedSession(), consumed: true }])

    const res = await req(app).get('/device-transfer/session-1')

    expect(res.status).toBe(410)
  })

  test('410s for an expired session', async () => {
    dbMock.queueSelect([{ ...uploadedSession(), expiresAt: past() }])

    const res = await req(app).get('/device-transfer/session-1')

    expect(res.status).toBe(410)
  })

  test('410s when another reader consumed it between the read and the update', async () => {
    // The conditional UPDATE is what actually claims the payload; losing that
    // race must not hand the seed to a second reader.
    dbMock.queueSelect([uploadedSession()])
    dbMock.queueReturning([])

    const res = await req(app).get('/device-transfer/session-1')

    expect(res.status).toBe(410)
    expect(res.body.message).toBe('Session already consumed')
  })
})

describe('DELETE /device-transfer/:id', () => {
  test('cancels the session', async () => {
    const res = await req(app).delete('/device-transfer/session-1')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    expect(dbMock.deleteCount).toBe(1)
  })

  test('reports success even when nothing matched', async () => {
    const res = await req(app).delete('/device-transfer/never-existed')

    expect(res.status).toBe(200)
  })
})

describe('POST /device-transfer/sweep', () => {
  test('deletes expired sessions', async () => {
    const res = await req(app).post('/device-transfer/sweep')

    expect(res.status).toBe(200)
    expect(dbMock.deleteCount).toBe(1)
  })

  test('still requires authentication', async () => {
    // The route is declared without its own `.use(requireAuth)`, but the
    // earlier `app.use(requireAuth)` calls apply to the shared instance, so
    // every route registered after them inherits the guard. A cron poking this
    // endpoint therefore needs a session.
    setAuthUser(null)

    const res = await req(app).post('/device-transfer/sweep')

    expect(res.status).toBe(401)
    expect(dbMock.deleteCount).toBe(0)
  })
})
