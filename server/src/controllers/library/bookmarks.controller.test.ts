/**
 * Endpoint tests for the bookmarks controller.
 *
 * The subtle rule here is on reassignment: changing `collectionIds` must be
 * authorized against the *union* of the collections being added and the ones
 * being removed. Gating only on the new set would let a viewer send
 * `collectionIds: []` and silently unlink a bookmark from a collection they
 * can only read. That case is asserted explicitly below.
 *
 * Sharing errors are also mapped deliberately: no-access is 404 (a 403 would
 * confirm the collection exists), wrong-role is 403.
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

const requireWriteAccessToCollection = mock(
  async (_userId: string, _collectionId: string) => undefined,
)

mock.module('../../services/sharing.service', () => ({
  requireWriteAccessToCollection,
  CollectionAccessDeniedError,
  InsufficientRoleError,
}))

const bookmarkRow = { id: 'bm-1', name: 'Cafe', lat: 35.2, lng: -80.8 }

const createBookmark = mock(async (_data: any, _collectionIds: string[]) => bookmarkRow)
const updateBookmark = mock(
  async (_id: string, _userId: string, _patch: any) =>
    bookmarkRow as typeof bookmarkRow | null | undefined,
)
const removeBookmarkFromCollections = mock(
  async (_id: string, _collectionIds: string[], _userId: string) => true,
)
const getCollectionsForBookmark = mock(async (_id: string, _userId: string) => [
  { id: 'col-1' },
])
const getFrequentBookmarks = mock(async (_userId: string) => [
  { ...bookmarkRow, frequentType: 'home' },
])

mock.module('../../services/library/bookmarks.service', () => ({
  createBookmark,
  updateBookmark,
  removeBookmarkFromCollections,
  getCollectionsForBookmark,
  getFrequentBookmarks,
}))

mock.module('../../middleware/auth.middleware', () => authMockModule())

const bookmarks = (await import('./bookmarks.controller')).default
const app = createTestApp(bookmarks)

const validBookmark = {
  externalIds: { osm: 'node/1' },
  name: 'Cafe',
  lat: 35.2,
  lng: -80.8,
  collectionIds: ['col-1'],
}

beforeEach(() => {
  resetAuth()
  requireWriteAccessToCollection.mockClear()
  requireWriteAccessToCollection.mockImplementation(async () => undefined)
  createBookmark.mockClear()
  createBookmark.mockImplementation(async () => bookmarkRow)
  updateBookmark.mockClear()
  updateBookmark.mockImplementation(async () => bookmarkRow)
  removeBookmarkFromCollections.mockClear()
  removeBookmarkFromCollections.mockImplementation(async () => true)
  getCollectionsForBookmark.mockClear()
  getCollectionsForBookmark.mockImplementation(async () => [{ id: 'col-1' }])
  getFrequentBookmarks.mockClear()
})

describe('gating', () => {
  const endpoints = [
    ['post', '/bookmarks'],
    ['put', '/bookmarks/bm-1'],
    ['delete', '/bookmarks/bm-1'],
    ['get', '/bookmarks/frequents'],
    ['get', '/bookmarks/bm-1/collections'],
  ] as const

  for (const [method, path] of endpoints) {
    test(`${method.toUpperCase()} ${path} rejects an unauthenticated caller`, async () => {
      setAuthUser(null)

      const res = await req(app)[method](path, {
        body: { ...validBookmark, collectionIds: ['col-1'] },
      })

      expect(res.status).toBe(401)
    })

    test(`${method.toUpperCase()} ${path} rejects a caller without library:write`, async () => {
      setHasPermission(false)

      const res = await req(app)[method](path, {
        body: { ...validBookmark, collectionIds: ['col-1'] },
      })

      expect(res.status).toBe(403)
    })
  }
})

describe('POST /bookmarks', () => {
  test('creates a bookmark owned by the caller and answers 201', async () => {
    const res = await req(app).post('/bookmarks', { body: validBookmark })

    expect(res.status).toBe(201)
    expect(createBookmark.mock.calls[0][0]).toMatchObject({
      name: 'Cafe',
      userId: TEST_USER.id,
    })
    expect(createBookmark.mock.calls[0][1]).toEqual(['col-1'])
  })

  test('checks write access on every target collection first', async () => {
    await req(app).post('/bookmarks', {
      body: { ...validBookmark, collectionIds: ['col-1', 'col-2'] },
    })

    expect(requireWriteAccessToCollection.mock.calls.map((c) => c[1])).toEqual([
      'col-1',
      'col-2',
    ])
  })

  test('allows a standalone bookmark with no collections', async () => {
    const res = await req(app).post('/bookmarks', {
      body: { ...validBookmark, collectionIds: [] },
    })

    expect(res.status).toBe(201)
    expect(requireWriteAccessToCollection).not.toHaveBeenCalled()
  })

  test('400s when externalIds is empty', async () => {
    const res = await req(app).post('/bookmarks', {
      body: { ...validBookmark, externalIds: {} },
    })

    expect(res.status).toBe(400)
    expect(createBookmark).not.toHaveBeenCalled()
  })

  test('422s when required fields are missing', async () => {
    const res = await req(app).post('/bookmarks', {
      body: { externalIds: { osm: 'node/1' }, collectionIds: [] },
    })

    expect(res.status).toBe(422)
  })

  test('422s on an unknown icon pack', async () => {
    const res = await req(app).post('/bookmarks', {
      body: { ...validBookmark, iconPack: 'fontawesome' },
    })

    expect(res.status).toBe(422)
  })

  test('404s when the caller has no access to a target collection', async () => {
    requireWriteAccessToCollection.mockRejectedValueOnce(
      new CollectionAccessDeniedError('no access'),
    )

    const res = await req(app).post('/bookmarks', { body: validBookmark })

    // 404 rather than 403 — a 403 would confirm the collection exists.
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Collection not found' })
    expect(createBookmark).not.toHaveBeenCalled()
  })

  test('403s when the caller is only a viewer on the collection', async () => {
    requireWriteAccessToCollection.mockRejectedValueOnce(
      new InsufficientRoleError('viewer'),
    )

    const res = await req(app).post('/bookmarks', { body: validBookmark })

    expect(res.status).toBe(403)
    expect(createBookmark).not.toHaveBeenCalled()
  })

  test('500s when the service fails for another reason', async () => {
    createBookmark.mockRejectedValueOnce(new Error('db down'))

    const res = await req(app).post('/bookmarks', { body: validBookmark })

    expect(res.status).toBe(500)
  })
})

describe('PUT /bookmarks/:id — reassignment authorization', () => {
  test('gates on collections being added', async () => {
    getCollectionsForBookmark.mockResolvedValueOnce([{ id: 'col-1' }])

    await req(app).put('/bookmarks/bm-1', {
      body: { collectionIds: ['col-1', 'col-2'] },
    })

    const checked = requireWriteAccessToCollection.mock.calls.map((c) => c[1])
    expect(checked).toContain('col-2')
  })

  test('also gates on collections being REMOVED', async () => {
    // Without this, a viewer on col-1 could unlink the bookmark from it by
    // sending a collectionIds list that simply omits col-1.
    getCollectionsForBookmark.mockResolvedValueOnce([{ id: 'col-1' }])

    await req(app).put('/bookmarks/bm-1', { body: { collectionIds: ['col-2'] } })

    const checked = requireWriteAccessToCollection.mock.calls.map((c) => c[1])
    expect(checked).toContain('col-1')
    expect(checked).toContain('col-2')
  })

  test('a viewer cannot unlink by sending an empty collection list', async () => {
    getCollectionsForBookmark.mockResolvedValueOnce([{ id: 'col-1' }])
    requireWriteAccessToCollection.mockRejectedValueOnce(
      new InsufficientRoleError('viewer'),
    )

    const res = await req(app).put('/bookmarks/bm-1', { body: { collectionIds: [] } })

    expect(res.status).toBe(403)
    expect(updateBookmark).not.toHaveBeenCalled()
  })

  test('skips the collection check when collectionIds is untouched', async () => {
    await req(app).put('/bookmarks/bm-1', { body: { name: 'Renamed' } })

    expect(getCollectionsForBookmark).not.toHaveBeenCalled()
    expect(requireWriteAccessToCollection).not.toHaveBeenCalled()
  })
})

describe('PUT /bookmarks/:id', () => {
  test('applies a partial update', async () => {
    const res = await req(app).put('/bookmarks/bm-1', { body: { name: 'Renamed' } })

    expect(res.status).toBe(200)
    expect(updateBookmark).toHaveBeenCalledWith('bm-1', TEST_USER.id, {
      name: 'Renamed',
    })
  })

  test('400s on an empty body', async () => {
    const res = await req(app).put('/bookmarks/bm-1', { body: {} })

    expect(res.status).toBe(400)
    expect(updateBookmark).not.toHaveBeenCalled()
  })

  test('404s when the bookmark is not the caller’s', async () => {
    updateBookmark.mockResolvedValueOnce(undefined)

    const res = await req(app).put('/bookmarks/other', { body: { name: 'x' } })

    expect(res.status).toBe(404)
  })

  test('204s when the update orphaned the bookmark and it was deleted', async () => {
    // The service returns null to signal "removed from its last collection".
    updateBookmark.mockResolvedValueOnce(null)

    const res = await req(app).put('/bookmarks/bm-1', { body: { collectionIds: [] } })

    expect(res.status).toBe(204)
  })

  test('accepts clearing frequentType with null', async () => {
    const res = await req(app).put('/bookmarks/bm-1', { body: { frequentType: null } })

    expect(res.status).toBe(200)
    expect(updateBookmark.mock.calls[0][2]).toEqual({ frequentType: null })
  })

  test('422s on an unknown frequentType', async () => {
    const res = await req(app).put('/bookmarks/bm-1', { body: { frequentType: 'gym' } })

    expect(res.status).toBe(422)
  })
})

describe('DELETE /bookmarks/:id', () => {
  test('removes the bookmark from the listed collections', async () => {
    const res = await req(app).delete('/bookmarks/bm-1', {
      body: { collectionIds: ['col-1'] },
    })

    expect(res.status).toBe(204)
    expect(removeBookmarkFromCollections).toHaveBeenCalledWith(
      'bm-1',
      ['col-1'],
      TEST_USER.id,
    )
  })

  test('400s when no collections are given', async () => {
    const res = await req(app).delete('/bookmarks/bm-1', { body: { collectionIds: [] } })

    expect(res.status).toBe(400)
    expect(removeBookmarkFromCollections).not.toHaveBeenCalled()
  })

  test('checks write access before removing', async () => {
    requireWriteAccessToCollection.mockRejectedValueOnce(
      new InsufficientRoleError('viewer'),
    )

    const res = await req(app).delete('/bookmarks/bm-1', {
      body: { collectionIds: ['col-1'] },
    })

    expect(res.status).toBe(403)
    expect(removeBookmarkFromCollections).not.toHaveBeenCalled()
  })

  test('404s when nothing was removed', async () => {
    removeBookmarkFromCollections.mockResolvedValueOnce(false)

    const res = await req(app).delete('/bookmarks/bm-1', {
      body: { collectionIds: ['col-1'] },
    })

    expect(res.status).toBe(404)
  })
})

describe('GET /bookmarks/frequents', () => {
  test('returns the caller’s frequents', async () => {
    const res = await req(app).get('/bookmarks/frequents')

    expect(res.status).toBe(200)
    expect(getFrequentBookmarks).toHaveBeenCalledWith(TEST_USER.id)
    expect(res.body[0].frequentType).toBe('home')
  })

  test('is not shadowed by the /:id/collections route', async () => {
    await req(app).get('/bookmarks/frequents')

    expect(getCollectionsForBookmark).not.toHaveBeenCalled()
  })
})

describe('GET /bookmarks/:id/collections', () => {
  test('lists the collections a bookmark belongs to, scoped to the caller', async () => {
    const res = await req(app).get('/bookmarks/bm-1/collections')

    expect(res.status).toBe(200)
    expect(getCollectionsForBookmark).toHaveBeenCalledWith('bm-1', TEST_USER.id)
  })
})
