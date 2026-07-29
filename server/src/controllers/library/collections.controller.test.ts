/**
 * Endpoint tests for the collections controller.
 *
 * The interesting rules all concern shared collections:
 *   - an editor may replace the encrypted metadata envelope but must NOT be
 *     able to flip `isPublic` — that's a privilege bit, not a content edit;
 *   - writes by an editor are persisted under the *owner's* id, so the
 *     owner-scoped reads still join;
 *   - no-access is reported as 404 and wrong-role as 403, so the endpoint
 *     can't be used to probe which collection ids exist.
 *
 * The scheme-change and key-rotation routes each map their own typed service
 * errors to distinct statuses (400 vs 409), which clients branch on.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import {
  authMockModule,
  setAuthUser,
  setHasPermission,
  resetAuth,
  TEST_USER,
} from '../../test/auth-mock'
import { createTestApp, req } from '../../test/app'

class CollectionAccessDeniedError extends Error {}
class InsufficientRoleError extends Error {}
class SchemeAlreadySetError extends Error {}
class CollectionVersionConflictError extends Error {}
class RotationVersionError extends Error {}
class PublicLinkNotAllowedOnE2eeError extends Error {}

const OWNER_ID = 'owner-9'
const collection = { id: 'col-1', userId: TEST_USER.id, scheme: 'server-key' }

let writeRole: 'owner' | 'editor' = 'owner'
const requireWriteAccessToCollection = mock(
  async (_userId: string, _id: string) => writeRole,
)

mock.module('../../services/sharing.service', () => ({
  requireWriteAccessToCollection,
  CollectionAccessDeniedError,
  InsufficientRoleError,
}))

const getCollections = mock(async (_userId: string) => [collection])
const createCollection = mock(async (input: any) => ({ ...collection, ...input }))
const getSharedCollections = mock(async (_userId: string) => [
  { ...collection, userId: OWNER_ID, role: 'editor' },
])
const getAccessibleCollection = mock(
  async (_id: string, _userId: string) =>
    ({ ...collection, role: writeRole }) as any,
)
const getBookmarksInCollection = mock(
  async (_id: string, _ownerId: string) => [{ id: 'bm-1' }],
)
const updateCollection = mock(
  async (_id: string, _userId: string, patch: any) =>
    ({ ...collection, ...patch }) as unknown,
)
const deleteCollection = mock(async (_id: string, _userId: string) => true)
const changeCollectionScheme = mock(async (_input: any) => collection as unknown)
const rotateCollectionKey = mock(async (_input: any) => collection as unknown)
const createPublicLink = mock(
  async (_id: string, _userId: string) =>
    ({ token: 'public-token' }) as { token: string } | null,
)
const revokePublicLink = mock(async (_id: string, _userId: string) => true)

mock.module('../../services/library/collections.service', () => ({
  getCollections,
  createCollection,
  getSharedCollections,
  getAccessibleCollection,
  getBookmarksInCollection,
  updateCollection,
  deleteCollection,
  changeCollectionScheme,
  rotateCollectionKey,
  createPublicLink,
  revokePublicLink,
  SchemeAlreadySetError,
  CollectionVersionConflictError,
  RotationVersionError,
  PublicLinkNotAllowedOnE2eeError,
}))

const setCollectionSensitive = mock(
  async (_id: string, _userId: string, _sensitive: boolean) => true,
)
const getEncryptedPointsInCollection = mock(
  async (_id: string, _userId: string) => [{ id: 'pt-1' }],
)
const createEncryptedPoint = mock(async (_input: any) => ({ id: 'pt-1' }))
const updateEncryptedPoint = mock(
  async (_pointId: string, _ownerId: string, _data: string, _nonce: string) =>
    ({ id: 'pt-1' }) as unknown,
)
const deleteEncryptedPoint = mock(
  async (_pointId: string, _ownerId: string) => true,
)

mock.module('../../services/library/encrypted-points.service', () => ({
  setCollectionSensitive,
  getEncryptedPointsInCollection,
  createEncryptedPoint,
  updateEncryptedPoint,
  deleteEncryptedPoint,
}))

mock.module('../../middleware/auth.middleware.js', () => authMockModule())
mock.module('../../middleware/auth.middleware', () => authMockModule())

const collections = (await import('./collections.controller')).default
const app = createTestApp(collections)

const schemeBody = {
  targetScheme: 'user-e2ee',
  newMetadataEncrypted: 'cipher',
  newMetadataKeyVersion: 2,
  updatedShareEnvelopes: [],
}

const rotateBody = {
  newMetadataEncrypted: 'cipher',
  newMetadataKeyVersion: 3,
  newEncryptedPoints: [],
  updatedShareEnvelopes: [],
  revokeRecipientHandles: [],
}

beforeEach(() => {
  resetAuth()
  writeRole = 'owner'
  requireWriteAccessToCollection.mockClear()
  requireWriteAccessToCollection.mockImplementation(async () => writeRole)
  getCollections.mockClear()
  createCollection.mockClear()
  getSharedCollections.mockClear()
  getAccessibleCollection.mockClear()
  getAccessibleCollection.mockImplementation(async () => ({
    ...collection,
    role: writeRole,
  }))
  getBookmarksInCollection.mockClear()
  getBookmarksInCollection.mockImplementation(async () => [{ id: 'bm-1' }])
  updateCollection.mockClear()
  updateCollection.mockImplementation(async (_id, _userId, patch: any) => ({
    ...collection,
    ...patch,
  }))
  deleteCollection.mockClear()
  deleteCollection.mockImplementation(async () => true)
  changeCollectionScheme.mockClear()
  changeCollectionScheme.mockImplementation(async () => collection)
  rotateCollectionKey.mockClear()
  rotateCollectionKey.mockImplementation(async () => collection)
  createPublicLink.mockClear()
  createPublicLink.mockImplementation(async () => ({ token: 'public-token' }))
  revokePublicLink.mockClear()
  revokePublicLink.mockImplementation(async () => true)
  setCollectionSensitive.mockClear()
  setCollectionSensitive.mockImplementation(async () => true)
  getEncryptedPointsInCollection.mockClear()
  createEncryptedPoint.mockClear()
  createEncryptedPoint.mockImplementation(async () => ({ id: 'pt-1' }))
  updateEncryptedPoint.mockClear()
  updateEncryptedPoint.mockImplementation(async () => ({ id: 'pt-1' }))
  deleteEncryptedPoint.mockClear()
  deleteEncryptedPoint.mockImplementation(async () => true)
})

describe('permission gating', () => {
  const endpoints = [
    ['get', '/collections'],
    ['post', '/collections'],
    ['get', '/collections/shared-with-me'],
    ['get', '/collections/col-1'],
    ['put', '/collections/col-1'],
    ['delete', '/collections/col-1'],
    ['put', '/collections/col-1/sensitive'],
    ['post', '/collections/col-1/change-scheme'],
    ['post', '/collections/col-1/rotate-key'],
    ['post', '/collections/col-1/public-link'],
    ['delete', '/collections/col-1/public-link'],
    ['get', '/collections/col-1/encrypted-points'],
    ['post', '/collections/col-1/encrypted-points'],
    ['put', '/collections/col-1/encrypted-points/pt-1'],
    ['delete', '/collections/col-1/encrypted-points/pt-1'],
  ] as const

  for (const [method, path] of endpoints) {
    test(`${method.toUpperCase()} ${path} rejects an unauthenticated caller`, async () => {
      setAuthUser(null)

      const res = await req(app)[method](path, {
        body: {
          metadataEncrypted: 'c',
          isSensitive: true,
          encryptedData: 'c',
          nonce: 'n',
          ...schemeBody,
          ...rotateBody,
        },
      })

      expect(res.status).toBe(401)
    })
  }

  test('a caller without library:write is refused', async () => {
    setHasPermission(false)

    const res = await req(app).get('/collections')

    expect(res.status).toBe(403)
  })
})

describe('GET /collections', () => {
  test('lists the caller’s own collections', async () => {
    const res = await req(app).get('/collections')

    expect(res.status).toBe(200)
    expect(getCollections).toHaveBeenCalledWith(TEST_USER.id)
  })

  test('shared-with-me is a separate list and not shadowed by /:id', async () => {
    const res = await req(app).get('/collections/shared-with-me')

    expect(res.status).toBe(200)
    expect(getSharedCollections).toHaveBeenCalledWith(TEST_USER.id)
    expect(getAccessibleCollection).not.toHaveBeenCalled()
  })
})

describe('POST /collections', () => {
  test('creates a collection owned by the caller', async () => {
    const res = await req(app).post('/collections', {
      body: { metadataEncrypted: 'cipher', metadataKeyVersion: 1 },
    })

    expect(res.status).toBe(200)
    expect(createCollection.mock.calls[0][0]).toMatchObject({
      metadataEncrypted: 'cipher',
      userId: TEST_USER.id,
    })
  })

  test('422s without the encrypted metadata envelope', async () => {
    const res = await req(app).post('/collections', { body: { isPublic: true } })

    expect(res.status).toBe(422)
    expect(createCollection).not.toHaveBeenCalled()
  })
})

describe('GET /collections/:id', () => {
  test('returns the collection with its bookmarks', async () => {
    const res = await req(app).get('/collections/col-1')

    expect(res.status).toBe(200)
    expect(res.body.bookmarks).toEqual([{ id: 'bm-1' }])
  })

  test('404s when the caller neither owns nor has a share', async () => {
    getAccessibleCollection.mockResolvedValueOnce(null)

    const res = await req(app).get('/collections/someone-elses')

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Collection not found' })
  })

  test('reads bookmarks under the OWNER’s id, not the caller’s', async () => {
    // A recipient's bookmark rows live on the owner's side of the join.
    getAccessibleCollection.mockResolvedValueOnce({
      ...collection,
      userId: OWNER_ID,
      role: 'viewer',
    })

    await req(app).get('/collections/col-1')

    expect(getBookmarksInCollection).toHaveBeenCalledWith('col-1', OWNER_ID)
  })
})

describe('PUT /collections/:id — role-scoped updates', () => {
  test('an owner may update the metadata envelope', async () => {
    const res = await req(app).put('/collections/col-1', {
      body: { metadataEncrypted: 'new-cipher' },
    })

    expect(res.status).toBe(200)
    expect(updateCollection.mock.calls[0][2]).toMatchObject({
      metadataEncrypted: 'new-cipher',
    })
  })

  test('an owner may flip isPublic', async () => {
    await req(app).put('/collections/col-1', { body: { isPublic: true } })

    expect((updateCollection.mock.calls[0][2] as any).isPublic).toBe(true)
  })

  test('an editor may update the metadata envelope', async () => {
    writeRole = 'editor'

    const res = await req(app).put('/collections/col-1', {
      body: { metadataEncrypted: 'new-cipher' },
    })

    expect(res.status).toBe(200)
    expect(updateCollection.mock.calls[0][2]).toMatchObject({
      metadataEncrypted: 'new-cipher',
    })
  })

  test('an editor CANNOT flip isPublic — it is stripped, not honoured', async () => {
    writeRole = 'editor'

    await req(app).put('/collections/col-1', {
      body: { metadataEncrypted: 'c', isPublic: true },
    })

    expect((updateCollection.mock.calls[0][2] as any).isPublic).toBeUndefined()
  })

  test('an editor’s write is persisted under the owner’s id', async () => {
    writeRole = 'editor'
    getAccessibleCollection.mockResolvedValue({
      ...collection,
      userId: OWNER_ID,
      role: 'editor',
    })

    await req(app).put('/collections/col-1', { body: { metadataEncrypted: 'c' } })

    expect(updateCollection.mock.calls[0][1]).toBe(OWNER_ID)
  })

  test('an owner’s write uses their own id directly', async () => {
    await req(app).put('/collections/col-1', { body: { metadataEncrypted: 'c' } })

    expect(updateCollection.mock.calls[0][1]).toBe(TEST_USER.id)
  })

  test('404s when the caller has no access at all', async () => {
    requireWriteAccessToCollection.mockRejectedValueOnce(
      new CollectionAccessDeniedError('denied'),
    )

    const res = await req(app).put('/collections/col-1', {
      body: { metadataEncrypted: 'c' },
    })

    expect(res.status).toBe(404)
    expect(updateCollection).not.toHaveBeenCalled()
  })

  test('403s for a viewer', async () => {
    requireWriteAccessToCollection.mockRejectedValueOnce(
      new InsufficientRoleError('viewer'),
    )

    const res = await req(app).put('/collections/col-1', {
      body: { metadataEncrypted: 'c' },
    })

    expect(res.status).toBe(403)
    expect(res.body.error).toContain('Viewer role cannot update')
  })

  test('404s when the update matched no row', async () => {
    updateCollection.mockResolvedValueOnce(null)

    const res = await req(app).put('/collections/col-1', {
      body: { metadataEncrypted: 'c' },
    })

    expect(res.status).toBe(404)
  })
})

describe('DELETE /collections/:id', () => {
  test('deletes and answers 204', async () => {
    const res = await req(app).delete('/collections/col-1')

    expect(res.status).toBe(204)
    expect(deleteCollection).toHaveBeenCalledWith('col-1', TEST_USER.id)
  })

  test('404s when nothing was deleted', async () => {
    deleteCollection.mockResolvedValueOnce(false)

    const res = await req(app).delete('/collections/missing')

    expect(res.status).toBe(404)
  })

  test('400s with the service message when deletion is refused', async () => {
    deleteCollection.mockRejectedValueOnce(
      new Error('Cannot delete a collection with active shares'),
    )

    const res = await req(app).delete('/collections/col-1')

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('active shares')
  })
})

describe('PUT /collections/:id/sensitive', () => {
  test('toggles sensitive mode', async () => {
    const res = await req(app).put('/collections/col-1/sensitive', {
      body: { isSensitive: true },
    })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true, isSensitive: true })
    expect(setCollectionSensitive).toHaveBeenCalledWith('col-1', TEST_USER.id, true)
  })

  test('404s for a collection the caller does not own', async () => {
    setCollectionSensitive.mockResolvedValueOnce(false)

    const res = await req(app).put('/collections/other/sensitive', {
      body: { isSensitive: true },
    })

    expect(res.status).toBe(404)
  })

  test('422s without the flag', async () => {
    const res = await req(app).put('/collections/col-1/sensitive', { body: {} })

    expect(res.status).toBe(422)
  })
})

describe('POST /collections/:id/change-scheme', () => {
  test('applies the migration and returns the collection', async () => {
    const res = await req(app).post('/collections/col-1/change-scheme', {
      body: schemeBody,
    })

    expect(res.status).toBe(200)
    expect(changeCollectionScheme.mock.calls[0][0]).toMatchObject({
      collectionId: 'col-1',
      userId: TEST_USER.id,
      targetScheme: 'user-e2ee',
    })
  })

  test('400s when the collection is already on that scheme', async () => {
    changeCollectionScheme.mockRejectedValueOnce(
      new SchemeAlreadySetError('already user-e2ee'),
    )

    const res = await req(app).post('/collections/col-1/change-scheme', {
      body: schemeBody,
    })

    expect(res.status).toBe(400)
  })

  test('409s on a version conflict so the client can re-stage', async () => {
    changeCollectionScheme.mockRejectedValueOnce(
      new CollectionVersionConflictError('collection changed underneath'),
    )

    const res = await req(app).post('/collections/col-1/change-scheme', {
      body: { ...schemeBody, expectedUpdatedAt: '2026-01-01T00:00:00Z' },
    })

    expect(res.status).toBe(409)
  })

  test('404s when the collection is not the caller’s', async () => {
    changeCollectionScheme.mockResolvedValueOnce(null)

    const res = await req(app).post('/collections/other/change-scheme', {
      body: schemeBody,
    })

    expect(res.status).toBe(404)
  })

  test('422s on an unknown target scheme', async () => {
    const res = await req(app).post('/collections/col-1/change-scheme', {
      body: { ...schemeBody, targetScheme: 'plaintext' },
    })

    expect(res.status).toBe(422)
    expect(changeCollectionScheme).not.toHaveBeenCalled()
  })

  test('422s when the share envelope list is missing', async () => {
    const { updatedShareEnvelopes, ...rest } = schemeBody

    const res = await req(app).post('/collections/col-1/change-scheme', {
      body: rest,
    })

    expect(res.status).toBe(422)
  })
})

describe('POST /collections/:id/rotate-key', () => {
  test('rotates and returns the collection', async () => {
    const res = await req(app).post('/collections/col-1/rotate-key', {
      body: rotateBody,
    })

    expect(res.status).toBe(200)
    expect(rotateCollectionKey.mock.calls[0][0]).toMatchObject({
      collectionId: 'col-1',
      userId: TEST_USER.id,
      newMetadataKeyVersion: 3,
    })
  })

  test('passes revoked recipients through so their shares are dropped', async () => {
    await req(app).post('/collections/col-1/rotate-key', {
      body: { ...rotateBody, revokeRecipientHandles: ['mallory@peer.test'] },
    })

    expect(
      (rotateCollectionKey.mock.calls[0][0] as any).revokeRecipientHandles,
    ).toEqual(['mallory@peer.test'])
  })

  test('400s on a key-version error', async () => {
    rotateCollectionKey.mockRejectedValueOnce(
      new RotationVersionError('key version must increase'),
    )

    const res = await req(app).post('/collections/col-1/rotate-key', {
      body: rotateBody,
    })

    expect(res.status).toBe(400)
  })

  test('404s when the collection is not the caller’s', async () => {
    rotateCollectionKey.mockResolvedValueOnce(null)

    const res = await req(app).post('/collections/other/rotate-key', {
      body: rotateBody,
    })

    expect(res.status).toBe(404)
  })

  test('422s when the encrypted point list is missing', async () => {
    const { newEncryptedPoints, ...rest } = rotateBody

    const res = await req(app).post('/collections/col-1/rotate-key', { body: rest })

    expect(res.status).toBe(422)
  })
})

describe('public links', () => {
  test('mints a token', async () => {
    const res = await req(app).post('/collections/col-1/public-link')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ token: 'public-token' })
  })

  test('404s for a collection the caller does not own', async () => {
    createPublicLink.mockResolvedValueOnce(null)

    const res = await req(app).post('/collections/other/public-link')

    expect(res.status).toBe(404)
  })

  test('400s for an end-to-end encrypted collection', async () => {
    createPublicLink.mockRejectedValueOnce(
      new PublicLinkNotAllowedOnE2eeError('not available for e2ee collections'),
    )

    const res = await req(app).post('/collections/col-1/public-link')

    expect(res.status).toBe(400)
  })

  test('revokes a token with 204', async () => {
    const res = await req(app).delete('/collections/col-1/public-link')

    expect(res.status).toBe(204)
    expect(revokePublicLink).toHaveBeenCalledWith('col-1', TEST_USER.id)
  })

  test('revoke 404s for an unknown collection', async () => {
    revokePublicLink.mockResolvedValueOnce(false)

    const res = await req(app).delete('/collections/missing/public-link')

    expect(res.status).toBe(404)
  })
})

describe('encrypted points', () => {
  test('lists points in a collection', async () => {
    const res = await req(app).get('/collections/col-1/encrypted-points')

    expect(res.status).toBe(200)
    expect(res.body.points).toEqual([{ id: 'pt-1' }])
    expect(getEncryptedPointsInCollection).toHaveBeenCalledWith('col-1', TEST_USER.id)
  })

  test('creates a point under the owner’s id when an editor writes', async () => {
    writeRole = 'editor'
    getAccessibleCollection.mockResolvedValue({
      ...collection,
      userId: OWNER_ID,
      role: 'editor',
    })

    const res = await req(app).post('/collections/col-1/encrypted-points', {
      body: { encryptedData: 'cipher', nonce: 'nonce' },
    })

    expect(res.status).toBe(200)
    expect(createEncryptedPoint.mock.calls[0][0]).toMatchObject({
      collectionId: 'col-1',
      userId: OWNER_ID,
    })
  })

  test('403s when a viewer tries to add a point', async () => {
    requireWriteAccessToCollection.mockRejectedValueOnce(
      new InsufficientRoleError('viewer'),
    )

    const res = await req(app).post('/collections/col-1/encrypted-points', {
      body: { encryptedData: 'c', nonce: 'n' },
    })

    expect(res.status).toBe(403)
    expect(createEncryptedPoint).not.toHaveBeenCalled()
  })

  test('404s when the caller has no access to the collection', async () => {
    requireWriteAccessToCollection.mockRejectedValueOnce(
      new CollectionAccessDeniedError('denied'),
    )

    const res = await req(app).post('/collections/col-1/encrypted-points', {
      body: { encryptedData: 'c', nonce: 'n' },
    })

    expect(res.status).toBe(404)
  })

  test('400s on other creation failures', async () => {
    createEncryptedPoint.mockRejectedValueOnce(new Error('collection is not e2ee'))

    const res = await req(app).post('/collections/col-1/encrypted-points', {
      body: { encryptedData: 'c', nonce: 'n' },
    })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('not e2ee')
  })

  test('422s without the ciphertext', async () => {
    const res = await req(app).post('/collections/col-1/encrypted-points', {
      body: { nonce: 'n' },
    })

    expect(res.status).toBe(422)
  })

  test('updates a point against the owner’s id', async () => {
    writeRole = 'editor'
    getAccessibleCollection.mockResolvedValue({
      ...collection,
      userId: OWNER_ID,
      role: 'editor',
    })

    const res = await req(app).put('/collections/col-1/encrypted-points/pt-1', {
      body: { encryptedData: 'new', nonce: 'n2' },
    })

    expect(res.status).toBe(200)
    expect(updateEncryptedPoint).toHaveBeenCalledWith('pt-1', OWNER_ID, 'new', 'n2')
  })

  test('update 404s when the point does not exist', async () => {
    updateEncryptedPoint.mockResolvedValueOnce(null)

    const res = await req(app).put('/collections/col-1/encrypted-points/missing', {
      body: { encryptedData: 'c', nonce: 'n' },
    })

    expect(res.status).toBe(404)
  })

  test('update 403s for a viewer', async () => {
    requireWriteAccessToCollection.mockRejectedValueOnce(
      new InsufficientRoleError('viewer'),
    )

    const res = await req(app).put('/collections/col-1/encrypted-points/pt-1', {
      body: { encryptedData: 'c', nonce: 'n' },
    })

    expect(res.status).toBe(403)
    expect(updateEncryptedPoint).not.toHaveBeenCalled()
  })

  test('deletes a point with 204', async () => {
    const res = await req(app).delete('/collections/col-1/encrypted-points/pt-1')

    expect(res.status).toBe(204)
    expect(deleteEncryptedPoint).toHaveBeenCalledWith('pt-1', TEST_USER.id)
  })

  test('delete 404s when the point is gone', async () => {
    deleteEncryptedPoint.mockResolvedValueOnce(false)

    const res = await req(app).delete('/collections/col-1/encrypted-points/missing')

    expect(res.status).toBe(404)
  })

  test('delete 403s for a viewer', async () => {
    requireWriteAccessToCollection.mockRejectedValueOnce(
      new InsufficientRoleError('viewer'),
    )

    const res = await req(app).delete('/collections/col-1/encrypted-points/pt-1')

    expect(res.status).toBe(403)
    expect(deleteEncryptedPoint).not.toHaveBeenCalled()
  })
})
