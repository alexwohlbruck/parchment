/**
 * The bookmark ↔ collection relation is stored on both sides, and offline
 * it is the only source of truth there is — the picker and the collection
 * view read it directly rather than asking the server.
 */
import { describe, test, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useCollectionsStore } from './collections.store'
import { useBookmarksStore } from './bookmarks.store'
import type { Bookmark, Collection } from '@/types/library.types'

function bookmark(id: string, collectionIds?: string[]): Bookmark {
  return {
    id,
    externalIds: { osm: `node/${id}` },
    name: `Place ${id}`,
    lat: 0,
    lng: 0,
    icon: 'marker',
    iconColor: 'blue',
    userId: 'u1',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...(collectionIds ? { collectionIds } : {}),
  }
}

function collection(id: string): Collection {
  return { id, name: `Collection ${id}`, userId: 'u1' } as Collection
}

describe('collections store — bookmark membership', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  test('reads membership from the collection side', () => {
    const collections = useCollectionsStore()
    collections.setCollections([
      { ...collection('c1'), bookmarks: [bookmark('b1')] },
      collection('c2'),
    ])
    expect(collections.getCollectionIdsForBookmark('b1')).toEqual(['c1'])
  })

  test('reads membership from the bookmark side when the collection has no contents', () => {
    const collections = useCollectionsStore()
    const bookmarks = useBookmarksStore()
    // A collection whose contents were never fetched.
    collections.setCollections([collection('c1'), collection('c2')])
    bookmarks.addBookmark(bookmark('b1', ['c2']))

    expect(collections.getCollectionIdsForBookmark('b1')).toEqual(['c2'])
  })

  test('ignores membership in collections we do not have', () => {
    const collections = useCollectionsStore()
    const bookmarks = useBookmarksStore()
    collections.setCollections([collection('c1')])
    bookmarks.addBookmark(bookmark('b1', ['c1', 'c-unknown']))

    expect(collections.getCollectionIdsForBookmark('b1')).toEqual(['c1'])
  })

  test('updateBookmarkCollections syncs both add and remove', () => {
    const collections = useCollectionsStore()
    collections.setCollections([
      { ...collection('c1'), bookmarks: [bookmark('b1')] },
      collection('c2'),
    ])

    collections.updateBookmarkCollections('b1', ['c2'])

    expect(collections.getCollectionIdsForBookmark('b1')).toEqual(['c2'])
    expect(collections.collections.find(c => c.id === 'c1')?.bookmarkIds).toEqual([])
    expect(collections.collections.find(c => c.id === 'c2')?.bookmarkIds).toEqual(['b1'])
  })

  test('updateBookmarkCollections does not write collection ids into contents', () => {
    // The previous implementation assigned `bookmarkIds = newCollectionIds`,
    // so a membership change replaced a collection's contents with a list
    // of collection ids.
    const collections = useCollectionsStore()
    collections.setCollections([
      { ...collection('c1'), bookmarks: [bookmark('b1'), bookmark('b2')] },
      collection('c2'),
    ])

    collections.updateBookmarkCollections('b1', ['c1', 'c2'])

    expect(collections.collections.find(c => c.id === 'c1')?.bookmarkIds).toEqual(['b1', 'b2'])
    expect(collections.collections.find(c => c.id === 'c2')?.bookmarkIds).toEqual(['b1'])
  })

  test('lists a collection’s places from the bookmark side when contents were never fetched', () => {
    const collections = useCollectionsStore()
    const bookmarks = useBookmarksStore()
    collections.setCollections([collection('c1')])
    bookmarks.addBookmark(bookmark('b1', ['c1']))
    bookmarks.addBookmark(bookmark('b2', ['c-other']))

    const hydrated = collections.getCollectionById('c1')
    expect(hydrated?.bookmarks?.map(b => b.id)).toEqual(['b1'])
  })

  test('keeps the server’s order and appends bookmark-side extras', () => {
    const collections = useCollectionsStore()
    const bookmarks = useBookmarksStore()
    collections.setCollections([
      { ...collection('c1'), bookmarks: [bookmark('b1'), bookmark('b2')] },
    ])
    // Saved offline after the collection was last fetched.
    bookmarks.addBookmark(bookmark('b3', ['c1']))

    const hydrated = collections.getCollectionById('c1')
    expect(hydrated?.bookmarks?.map(b => b.id)).toEqual(['b1', 'b2', 'b3'])
  })
})
