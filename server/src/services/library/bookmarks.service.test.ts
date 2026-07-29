/**
 * Unit tests for the bookmarks service.
 *
 * `updateBookmark` carries the subtlety. It deliberately splits two cases:
 *
 *   - changing bookmark FIELDS is owner-only (the `userId` filter enforces it);
 *   - changing only `collectionIds` edits pivot rows, so a collection owner or
 *     editor may re-link a bookmark someone else created — access control
 *     already happened in the controller. That path must NOT apply the owner
 *     filter, or Alice couldn't remove a bookmark Bob added to her collection.
 *
 * The orphan path is the other trap: when the last collection link is removed
 * the bookmark row is deleted inline using the PRE-delete collection set,
 * because routing through `unbookmark` would snapshot an already-empty pivot
 * table and silently emit nothing (recipients would keep a phantom bookmark).
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { createDbMock } from '../../test/db-mock'

const dbMock = createDbMock()
mock.module('../../db', () => ({ db: dbMock.db }))
mock.module('../../util', () => ({ generateId: () => 'new-bookmark-id' }))

mock.module('../../util/geometry-conversion', () => ({
  createSelectFieldsWithGeometry: () => ({}),
  createPointFromCoordinates: (lat: number, lng: number) => `POINT(${lng} ${lat})`,
}))

mock.module('../../util/text-search.util', () => ({
  createBookmarkSearchCondition: (..._args: unknown[]) => 'search-condition',
}))

const emitBookmark = mock(async (..._args: unknown[]) => undefined)
const emitAcrossCollections = mock(async (..._args: unknown[]) => undefined)
mock.module('../realtime/emit', () => ({
  emit: {
    bookmark: emitBookmark,
    bookmarkAcrossCollections: emitAcrossCollections,
  },
}))

mock.module('../../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
  logWarn: () => {},
  logError: () => {},
}))

const {
  getBookmarkById,
  createBookmark,
  updateBookmark,
  unbookmark,
  getCollectionsForBookmark,
  getFrequentBookmarks,
  searchBookmarks,
} = await import('./bookmarks.service')

const bookmark = { id: 'bm-1', name: 'Cafe', userId: 'user-1' }

const createParams = {
  externalIds: { osm: 'node/1' },
  name: 'Cafe',
  lat: 35.2,
  lng: -80.8,
  userId: 'user-1',
} as any

beforeEach(() => {
  dbMock.reset()
  emitBookmark.mockClear()
  emitAcrossCollections.mockClear()
})

describe('getBookmarkById', () => {
  test('returns the bookmark scoped to the owner', async () => {
    dbMock.queueSelect([bookmark])

    expect((await getBookmarkById('bm-1', 'user-1')).id).toBe('bm-1')
  })

  test('returns undefined for someone else’s bookmark', async () => {
    dbMock.queueSelect([])

    expect(await getBookmarkById('bm-1', 'other')).toBeUndefined()
  })
})

describe('createBookmark', () => {
  test('inserts the bookmark with generated id and geometry', async () => {
    dbMock.setReturningRows([bookmark])

    await createBookmark(createParams, ['col-1'])

    expect(dbMock.inserted[0]).toMatchObject({
      id: 'new-bookmark-id',
      name: 'Cafe',
      userId: 'user-1',
      geometry: 'POINT(-80.8 35.2)',
    })
  })

  test('applies icon defaults', async () => {
    dbMock.setReturningRows([bookmark])

    await createBookmark(createParams, [])

    expect(dbMock.inserted[0]).toMatchObject({
      icon: 'map-pin',
      iconPack: 'lucide',
      iconColor: '#F43F5E',
    })
  })

  test('honours supplied icon fields', async () => {
    dbMock.setReturningRows([bookmark])

    await createBookmark(
      { ...createParams, icon: 'coffee', iconPack: 'maki', iconColor: '#000' },
      [],
    )

    expect(dbMock.inserted[0]).toMatchObject({
      icon: 'coffee',
      iconPack: 'maki',
      iconColor: '#000',
    })
  })

  test('links the bookmark to each collection and touches them', async () => {
    dbMock.setReturningRows([bookmark])

    await createBookmark(createParams, ['col-1', 'col-2'])

    const relations = dbMock.inserted[1] as any[]
    expect(relations.map((r) => r.collectionId)).toEqual(['col-1', 'col-2'])
    expect((dbMock.updated[0] as any).updatedAt).toBeInstanceOf(Date)
  })

  test('a standalone bookmark writes no pivot rows', async () => {
    // Frequents live outside any collection.
    dbMock.setReturningRows([bookmark])

    await createBookmark(createParams, [])

    expect(dbMock.insertCount).toBe(1)
    expect(dbMock.updateCount).toBe(0)
  })

  test('broadcasts the new bookmark with its collection ids', async () => {
    dbMock.setReturningRows([bookmark])

    await createBookmark(createParams, ['col-1'])

    expect(emitAcrossCollections).toHaveBeenCalledWith(
      'bookmark:created',
      expect.objectContaining({ id: 'bm-1', collectionIds: ['col-1'] }),
      ['col-1'],
    )
  })
})

describe('updateBookmark — ownership split', () => {
  test('a field change is scoped to the owner', async () => {
    dbMock.setReturningRows([bookmark])
    dbMock.queueSelect([]) // post-update collection read

    const result = await updateBookmark('bm-1', 'user-1', { name: 'Renamed' })

    expect(result).toEqual(bookmark)
    expect(dbMock.updated[0]).toMatchObject({ name: 'Renamed' })
  })

  test('a field change on someone else’s bookmark returns null', async () => {
    dbMock.setReturningRows([])

    expect(await updateBookmark('bm-1', 'other', { name: 'x' })).toBeNull()
  })

  test('a collection-only change skips the owner-filtered update', async () => {
    // Alice must be able to unlink a bookmark Bob created in her collection.
    dbMock.queueSelect([bookmark]) // unfiltered lookup
    dbMock.queueSelect([{ collectionId: 'col-1' }]) // current links
    dbMock.queueSelect([{ value: 1 }]) // remaining count
    dbMock.queueSelect([{ collectionId: 'col-2' }]) // post-update links

    const result = await updateBookmark('bm-1', 'not-the-owner', {
      collectionIds: ['col-2'],
    })

    expect(result).toEqual(bookmark)
    // No bookmark-row update was issued, only pivot writes.
    expect(dbMock.updated.some((u: any) => 'name' in u)).toBe(false)
  })

  test('a collection-only change on a missing bookmark returns null', async () => {
    dbMock.queueSelect([])

    expect(
      await updateBookmark('missing', 'user-1', { collectionIds: [] }),
    ).toBeNull()
  })

  test('converts lat/lng into geometry', async () => {
    dbMock.setReturningRows([bookmark])
    dbMock.queueSelect([])

    await updateBookmark('bm-1', 'user-1', { lat: 1, lng: 2 } as any)

    expect((dbMock.updated[0] as any).geometry).toBe('POINT(2 1)')
  })

  test('never lets a caller rewrite id, userId or externalIds', async () => {
    dbMock.setReturningRows([bookmark])
    dbMock.queueSelect([])

    await updateBookmark('bm-1', 'user-1', {
      name: 'Renamed',
      id: 'hijack',
      userId: 'someone-else',
      externalIds: { osm: 'node/999' },
    } as any)

    const written = dbMock.updated[0] as any
    expect('id' in written).toBe(false)
    expect('userId' in written).toBe(false)
    expect('externalIds' in written).toBe(false)
  })
})

describe('updateBookmark — collection membership diff', () => {
  test('adds newly listed collections', async () => {
    dbMock.setReturningRows([bookmark])
    dbMock.queueSelect([{ collectionId: 'col-1' }]) // current
    dbMock.queueSelect([{ collectionId: 'col-1' }, { collectionId: 'col-2' }])

    await updateBookmark('bm-1', 'user-1', {
      name: 'Renamed',
      collectionIds: ['col-1', 'col-2'],
    })

    const added = dbMock.inserted[0] as any[]
    expect(added.map((r) => r.collectionId)).toEqual(['col-2'])
  })

  test('removes collections that dropped off the list', async () => {
    dbMock.setReturningRows([bookmark])
    dbMock.queueSelect([{ collectionId: 'col-1' }, { collectionId: 'col-2' }])
    dbMock.queueSelect([{ value: 1 }]) // still linked somewhere
    dbMock.queueSelect([{ collectionId: 'col-1' }])

    await updateBookmark('bm-1', 'user-1', {
      name: 'Renamed',
      collectionIds: ['col-1'],
    })

    expect(dbMock.deleteCount).toBe(1)
  })

  test('emits unlinked for the removed collections', async () => {
    dbMock.setReturningRows([bookmark])
    dbMock.queueSelect([{ collectionId: 'col-1' }, { collectionId: 'col-2' }])
    dbMock.queueSelect([{ value: 1 }])
    dbMock.queueSelect([{ collectionId: 'col-1' }])

    await updateBookmark('bm-1', 'user-1', {
      name: 'Renamed',
      collectionIds: ['col-1'],
    })

    expect(emitAcrossCollections).toHaveBeenCalledWith(
      'bookmark:unlinked',
      { id: 'bm-1', collectionIds: ['col-2'] },
      ['col-2'],
    )
  })

  test('leaves membership alone when collectionIds is omitted', async () => {
    dbMock.setReturningRows([bookmark])
    dbMock.queueSelect([{ collectionId: 'col-1' }])

    await updateBookmark('bm-1', 'user-1', { name: 'Renamed' })

    expect(dbMock.deleteCount).toBe(0)
    expect(dbMock.insertCount).toBe(0)
  })

  test('emits the updated bookmark with its post-update collections', async () => {
    dbMock.setReturningRows([bookmark])
    dbMock.queueSelect([{ collectionId: 'col-1' }])

    await updateBookmark('bm-1', 'user-1', { name: 'Renamed' })

    expect(emitBookmark).toHaveBeenCalledWith(
      'bookmark:updated',
      expect.objectContaining({ collectionIds: ['col-1'] }),
      'bm-1',
    )
  })
})

describe('updateBookmark — orphan deletion', () => {
  function orphaning() {
    dbMock.setReturningRows([bookmark])
    dbMock.queueSelect([{ collectionId: 'col-1' }]) // current links
    dbMock.queueSelect([{ value: 0 }]) // nothing left after removal
  }

  test('deletes the bookmark when its last link is removed', async () => {
    orphaning()

    const result = await updateBookmark('bm-1', 'user-1', {
      name: 'Renamed',
      collectionIds: [],
    })

    expect(result).toBeNull()
    // Pivot delete plus the bookmark row delete.
    expect(dbMock.deleteCount).toBe(2)
  })

  test('emits deleted with the PRE-delete collection set', async () => {
    // The pivot rows are already gone, so a fresh lookup would return none and
    // recipients would never hear about the removal.
    orphaning()

    await updateBookmark('bm-1', 'user-1', { name: 'Renamed', collectionIds: [] })

    expect(emitAcrossCollections).toHaveBeenCalledWith(
      'bookmark:deleted',
      { id: 'bm-1', collectionIds: ['col-1'] },
      ['col-1'],
    )
  })

  test('does not also emit updated for a deleted bookmark', async () => {
    orphaning()

    await updateBookmark('bm-1', 'user-1', { name: 'Renamed', collectionIds: [] })

    expect(emitBookmark).not.toHaveBeenCalled()
  })
})

describe('unbookmark', () => {
  test('drops pivot rows then the bookmark itself', async () => {
    dbMock.queueSelect([{ collectionId: 'col-1' }])
    dbMock.setReturningRows([bookmark])

    await unbookmark('bm-1', 'user-1')

    expect(dbMock.deleteCount).toBe(2)
  })

  test('emits deleted with the collections captured before the delete', async () => {
    dbMock.queueSelect([{ collectionId: 'col-1' }, { collectionId: 'col-2' }])
    dbMock.setReturningRows([bookmark])

    await unbookmark('bm-1', 'user-1')

    expect(emitAcrossCollections).toHaveBeenCalledWith(
      'bookmark:deleted',
      { id: 'bm-1', collectionIds: ['col-1', 'col-2'] },
      ['col-1', 'col-2'],
    )
  })

  test('stays quiet for a standalone bookmark with no collections', async () => {
    dbMock.queueSelect([])
    dbMock.setReturningRows([bookmark])

    await unbookmark('bm-1', 'user-1')

    expect(emitAcrossCollections).not.toHaveBeenCalled()
  })

  test('emits nothing when the delete matched no row', async () => {
    dbMock.queueSelect([{ collectionId: 'col-1' }])
    dbMock.setReturningRows([])

    expect(await unbookmark('bm-1', 'other')).toBeUndefined()
    expect(emitAcrossCollections).not.toHaveBeenCalled()
  })
})

describe('reads', () => {
  test('getCollectionsForBookmark scopes to the caller', async () => {
    dbMock.setSelectRows([{ id: 'col-1' }])

    expect(await getCollectionsForBookmark('bm-1', 'user-1')).toHaveLength(1)
  })

  test('getFrequentBookmarks returns the tagged standalone bookmarks', async () => {
    dbMock.queueSelect([{ ...bookmark, frequentType: 'home' }])

    const rows = await getFrequentBookmarks('user-1')

    expect(rows).toHaveLength(1)
    expect((rows[0] as any).frequentType).toBe('home')
  })

  test('searchBookmarks with an empty query returns everything', async () => {
    dbMock.queueSelect([bookmark, { ...bookmark, id: 'bm-2' }])

    expect(await searchBookmarks('user-1', '')).toHaveLength(2)
  })

  test('searchBookmarks with a query filters', async () => {
    dbMock.queueSelect([bookmark])

    expect(await searchBookmarks('user-1', 'cafe')).toHaveLength(1)
  })
})
