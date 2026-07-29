/**
 * Endpoint tests for the personal-blob controller.
 *
 * The blob payload is opaque to the server, so the contract worth pinning down
 * is the envelope: permission gating, the blob-type character whitelist, the
 * 204-on-empty-slot behaviour, and the defaults applied to optional fields.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import {
  authMockModule,
  setAuthUser,
  setHasPermission,
  resetAuth,
  TEST_USER,
} from '../test/auth-mock'
import { createTestApp, req } from '../test/app'

const blobRow = {
  encryptedBlob: 'ciphertext',
  nonce: 'nonce-1',
  kmVersion: 3,
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const getPersonalBlob = mock(
  async (_userId: string, _type: string) => blobRow as typeof blobRow | null,
)
const putPersonalBlob = mock(
  async (_userId: string, _type: string, _payload: unknown) => undefined,
)
const deletePersonalBlob = mock(async (_userId: string, _type: string) => undefined)
const listPersonalBlobTypes = mock(async (_userId: string) => [
  { blobType: 'settings', kmVersion: 3 },
])

mock.module('../services/personal-blob.service', () => ({
  getPersonalBlob,
  putPersonalBlob,
  deletePersonalBlob,
  listPersonalBlobTypes,
}))

mock.module('../middleware/auth.middleware', () => authMockModule())

const personalBlob = (await import('./personal-blob.controller')).default
const app = createTestApp(personalBlob)

beforeEach(() => {
  resetAuth()
  getPersonalBlob.mockClear()
  putPersonalBlob.mockClear()
  deletePersonalBlob.mockClear()
  listPersonalBlobTypes.mockClear()
})

describe('permission gating', () => {
  const routes = [
    ['get', '/me/blobs'],
    ['get', '/me/blobs/settings'],
    ['put', '/me/blobs/settings'],
    ['delete', '/me/blobs/settings'],
  ] as const

  for (const [method, path] of routes) {
    test(`${method.toUpperCase()} ${path} rejects an unauthenticated caller`, async () => {
      setAuthUser(null)

      const res = await req(app)[method](path, { body: { encryptedBlob: 'x' } })

      expect(res.status).toBe(401)
    })

    test(`${method.toUpperCase()} ${path} rejects a caller without the library permission`, async () => {
      setHasPermission(false)

      const res = await req(app)[method](path, { body: { encryptedBlob: 'x' } })

      expect(res.status).toBe(403)
    })
  }
})

describe('GET /me/blobs', () => {
  test('lists the caller’s blob types with their key-material versions', async () => {
    const res = await req(app).get('/me/blobs')

    expect(res.status).toBe(200)
    expect(listPersonalBlobTypes).toHaveBeenCalledWith(TEST_USER.id)
    expect(res.body).toEqual({ blobs: [{ blobType: 'settings', kmVersion: 3 }] })
  })
})

describe('GET /me/blobs/:type', () => {
  test('returns the stored blob', async () => {
    const res = await req(app).get('/me/blobs/settings')

    expect(res.status).toBe(200)
    expect(getPersonalBlob).toHaveBeenCalledWith(TEST_USER.id, 'settings')
    expect(res.body).toEqual(blobRow)
  })

  test('returns 204, not 404, for a slot that was never written', async () => {
    getPersonalBlob.mockResolvedValueOnce(null)

    const res = await req(app).get('/me/blobs/settings')

    // An empty slot is a normal state for a fresh client, not a missing
    // resource — clients treat 404 as an error.
    expect(res.status).toBe(204)
  })

  test('rejects a blob type with characters outside the whitelist', async () => {
    const res = await req(app).get('/me/blobs/bad type!')

    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Invalid blob type')
    expect(getPersonalBlob).not.toHaveBeenCalled()
  })

  test('rejects a blob type longer than 64 characters', async () => {
    const res = await req(app).get(`/me/blobs/${'a'.repeat(65)}`)

    expect(res.status).toBe(400)
    expect(getPersonalBlob).not.toHaveBeenCalled()
  })

  test('accepts dots, colons, dashes and underscores in a type', async () => {
    const res = await req(app).get('/me/blobs/app.settings:v2-beta_1')

    expect(res.status).toBe(200)
    expect(getPersonalBlob).toHaveBeenCalledWith(TEST_USER.id, 'app.settings:v2-beta_1')
  })
})

describe('PUT /me/blobs/:type', () => {
  test('stores the blob for the caller', async () => {
    const res = await req(app).put('/me/blobs/settings', {
      body: { encryptedBlob: 'ciphertext', nonce: 'n1', kmVersion: 5 },
    })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    expect(putPersonalBlob).toHaveBeenCalledWith(TEST_USER.id, 'settings', {
      encryptedBlob: 'ciphertext',
      nonce: 'n1',
      kmVersion: 5,
    })
  })

  test('defaults nonce to empty and kmVersion to 1 when omitted', async () => {
    await req(app).put('/me/blobs/settings', { body: { encryptedBlob: 'ciphertext' } })

    expect(putPersonalBlob).toHaveBeenCalledWith(TEST_USER.id, 'settings', {
      encryptedBlob: 'ciphertext',
      nonce: '',
      kmVersion: 1,
    })
  })

  test('rejects a body with no encryptedBlob', async () => {
    const res = await req(app).put('/me/blobs/settings', { body: { nonce: 'n1' } })

    expect(res.status).toBe(422)
    expect(putPersonalBlob).not.toHaveBeenCalled()
  })

  test('rejects an invalid blob type before writing', async () => {
    const res = await req(app).put('/me/blobs/bad type!', {
      body: { encryptedBlob: 'ciphertext' },
    })

    expect(res.status).toBe(400)
    expect(putPersonalBlob).not.toHaveBeenCalled()
  })
})

describe('DELETE /me/blobs/:type', () => {
  test('deletes the blob', async () => {
    const res = await req(app).delete('/me/blobs/settings')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    expect(deletePersonalBlob).toHaveBeenCalledWith(TEST_USER.id, 'settings')
  })

  test('rejects an invalid blob type before deleting', async () => {
    const res = await req(app).delete('/me/blobs/bad type!')

    expect(res.status).toBe(400)
    expect(deletePersonalBlob).not.toHaveBeenCalled()
  })
})
