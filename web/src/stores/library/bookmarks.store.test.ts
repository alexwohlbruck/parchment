/**
 * Unit tests for bookmarks store
 *
 * Tests cover:
 * - CRUD operations (add, update, remove, set)
 * - Queries (getBookmarkById, getBookmarkByExternalId, isPlaceSaved)
 * - Navigation helper
 */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useBookmarksStore } from './bookmarks.store'
import type { Bookmark } from '@/types/library.types'

// Mock collections store
vi.mock('./collections.store', () => ({
  useCollectionsStore: () => ({
    updateBookmarkCollections: vi.fn(),
  }),
}))

// Mock useStorage
vi.mock('@vueuse/core', () => ({
  useStorage: (key: string, defaultValue: any) => {
    return ref(defaultValue)
  },
}))

import { ref } from 'vue'

describe('useBookmarksStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('Initial state', () => {
    test('starts with empty bookmarks', () => {
      const store = useBookmarksStore()
      
      expect(store.bookmarks).toEqual([])
    })
  })

  describe('addBookmark', () => {
    test('adds a bookmark', () => {
      const store = useBookmarksStore()
      const bookmark: Bookmark = {
        id: 'bm-1',
        name: 'Coffee Shop',
        externalIds: { osm: '123', osmType: 'node' },
      } as unknown as Bookmark

      store.addBookmark(bookmark)

      expect(store.bookmarks).toHaveLength(1)
      expect(store.bookmarks[0]).toEqual(bookmark)
    })

    test('adds multiple bookmarks', () => {
      const store = useBookmarksStore()
      const bookmark1: Bookmark = {
        id: 'bm-1',
        name: 'Coffee Shop',
        externalIds: {},
      } as unknown as Bookmark
      const bookmark2: Bookmark = {
        id: 'bm-2',
        name: 'Restaurant',
        externalIds: {},
      } as unknown as Bookmark

      store.addBookmark(bookmark1)
      store.addBookmark(bookmark2)

      expect(store.bookmarks).toHaveLength(2)
    })
  })

  describe('updateBookmark', () => {
    test('updates existing bookmark', () => {
      const store = useBookmarksStore()
      const bookmark: Bookmark = {
        id: 'bm-1',
        name: 'Coffee Shop',
        externalIds: {},
      } as unknown as Bookmark
      store.addBookmark(bookmark)

      const updated: Bookmark = {
        ...bookmark,
        name: 'Updated Coffee Shop',
      }
      store.updateBookmark('bm-1', updated)

      expect(store.bookmarks[0].name).toBe('Updated Coffee Shop')
    })

    test('does nothing if bookmark not found', () => {
      const store = useBookmarksStore()
      const bookmark: Bookmark = {
        id: 'bm-1',
        name: 'Coffee Shop',
        externalIds: {},
      } as unknown as Bookmark
      store.addBookmark(bookmark)

      store.updateBookmark('non-existent', { ...bookmark, name: 'Updated' })

      expect(store.bookmarks[0].name).toBe('Coffee Shop')
    })
  })

  describe('removeBookmark', () => {
    test('removes bookmark by id', () => {
      const store = useBookmarksStore()
      const bookmark1: Bookmark = {
        id: 'bm-1',
        name: 'Coffee Shop',
        externalIds: {},
      } as unknown as Bookmark
      const bookmark2: Bookmark = {
        id: 'bm-2',
        name: 'Restaurant',
        externalIds: {},
      } as unknown as Bookmark
      store.addBookmark(bookmark1)
      store.addBookmark(bookmark2)

      store.removeBookmark('bm-1')

      expect(store.bookmarks).toHaveLength(1)
      expect(store.bookmarks[0].id).toBe('bm-2')
    })

    test('does nothing if bookmark not found', () => {
      const store = useBookmarksStore()
      const bookmark: Bookmark = {
        id: 'bm-1',
        name: 'Coffee Shop',
        externalIds: {},
      } as unknown as Bookmark
      store.addBookmark(bookmark)

      store.removeBookmark('non-existent')

      expect(store.bookmarks).toHaveLength(1)
    })
  })

  describe('setBookmarks', () => {
    test('replaces all bookmarks', () => {
      const store = useBookmarksStore()
      const bookmark1: Bookmark = {
        id: 'bm-1',
        name: 'Coffee Shop',
        externalIds: {},
      } as unknown as Bookmark
      store.addBookmark(bookmark1)

      const newBookmarks: Bookmark[] = [
        { id: 'bm-2', name: 'Restaurant', externalIds: {} } as unknown as Bookmark,
        { id: 'bm-3', name: 'Park', externalIds: {} } as unknown as Bookmark,
      ]
      store.setBookmarks(newBookmarks)

      expect(store.bookmarks).toEqual(newBookmarks)
      expect(store.bookmarks).toHaveLength(2)
    })
  })

  describe('getBookmarkById', () => {
    test('finds bookmark by id', () => {
      const store = useBookmarksStore()
      const bookmark: Bookmark = {
        id: 'bm-1',
        name: 'Coffee Shop',
        externalIds: {},
      } as unknown as Bookmark
      store.addBookmark(bookmark)

      const found = store.getBookmarkById('bm-1')

      expect(found).toEqual(bookmark)
    })

    test('returns undefined if not found', () => {
      const store = useBookmarksStore()

      const found = store.getBookmarkById('non-existent')

      expect(found).toBeUndefined()
    })
  })

  describe('getBookmarkByExternalId', () => {
    test('finds bookmark by external id', () => {
      const store = useBookmarksStore()
      const bookmark: Bookmark = {
        id: 'bm-1',
        name: 'Coffee Shop',
        externalIds: { osm: '123', osmType: 'node' },
      } as unknown as Bookmark
      store.addBookmark(bookmark)

      const found = store.getBookmarkByExternalId('osm', '123')

      expect(found).toEqual(bookmark)
    })

    test('returns undefined if not found', () => {
      const store = useBookmarksStore()

      const found = store.getBookmarkByExternalId('osm', '999')

      expect(found).toBeUndefined()
    })
  })

  describe('isPlaceSaved', () => {
    test('returns true if place is saved', () => {
      const store = useBookmarksStore()
      const bookmark: Bookmark = {
        id: 'bm-1',
        name: 'Coffee Shop',
        externalIds: { osm: '123', osmType: 'node' },
      } as unknown as Bookmark
      store.addBookmark(bookmark)

      const saved = store.isPlaceSaved({ osm: '123' })

      expect(saved).toBe(true)
    })

    test('returns false if place is not saved', () => {
      const store = useBookmarksStore()

      const saved = store.isPlaceSaved({ osm: '999' })

      expect(saved).toBe(false)
    })

    test('matches any external id provider', () => {
      const store = useBookmarksStore()
      const bookmark: Bookmark = {
        id: 'bm-1',
        name: 'Coffee Shop',
        externalIds: { osm: '123', google: 'abc' },
      } as unknown as Bookmark
      store.addBookmark(bookmark)

      const savedByOsm = store.isPlaceSaved({ osm: '123' })
      const savedByGoogle = store.isPlaceSaved({ google: 'abc' })
      const savedByBoth = store.isPlaceSaved({ osm: '123', google: 'abc' })

      expect(savedByOsm).toBe(true)
      expect(savedByGoogle).toBe(true)
      expect(savedByBoth).toBe(true)
    })
  })

  describe('navigateToBookmark', () => {
    test('returns route for OSM bookmark', () => {
      const store = useBookmarksStore()
      const bookmark: Bookmark = {
        id: 'bm-1',
        name: 'Coffee Shop',
        externalIds: { osm: '123', osmType: 'node' },
      } as unknown as Bookmark

      const route = store.navigateToBookmark(bookmark)

      expect(route).toEqual({
        name: 'Place',
        params: { type: 'node', id: '123' },
      })
    })

    test('uses default osmType if not provided', () => {
      const store = useBookmarksStore()
      const bookmark: Bookmark = {
        id: 'bm-1',
        name: 'Coffee Shop',
        externalIds: { osm: '123' },
      } as unknown as Bookmark

      const route = store.navigateToBookmark(bookmark)

      expect(route).toEqual({
        name: 'Place',
        params: { type: 'node', id: '123' },
      })
    })

    test('returns null if no OSM id', () => {
      const store = useBookmarksStore()
      const bookmark: Bookmark = {
        id: 'bm-1',
        name: 'Coffee Shop',
        externalIds: { google: 'abc' },
      } as unknown as Bookmark

      const route = store.navigateToBookmark(bookmark)

      expect(route).toBeNull()
    })
  })
})
