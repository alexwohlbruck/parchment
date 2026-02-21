/**
 * Unit tests for search store
 *
 * Tests cover:
 * - State management (results, loading, error)
 * - Computed values (hasResults, isLoading, hitMaxResults)
 * - Actions (set, clear, add, remove)
 */

import { describe, test, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSearchStore } from './search.store'
import type { Place } from '@/types/place.types'

describe('useSearchStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('Initial state', () => {
    test('starts with empty results', () => {
      const store = useSearchStore()
      
      expect(store.searchResults).toEqual([])
      expect(store.hasResults).toBe(false)
      expect(store.lastResultCount).toBe(0)
    })

    test('starts with no loading or error', () => {
      const store = useSearchStore()
      
      expect(store.isSearching).toBe(false)
      expect(store.isMapRefreshing).toBe(false)
      expect(store.isLoading).toBe(false)
      expect(store.searchError).toBeNull()
    })

    test('starts with default search metadata', () => {
      const store = useSearchStore()
      
      expect(store.searchQuery).toBeNull()
      expect(store.searchType).toBe('text')
      expect(store.lastSearchBounds).toBeNull()
      expect(store.lastMaxResults).toBeNull()
    })
  })

  describe('setSearchResults', () => {
    test('sets results and updates count', () => {
      const store = useSearchStore()
      const places: Place[] = [
        { id: '1', name: { value: 'Place 1', sourceId: 'test', timestamp: '' } } as Place,
        { id: '2', name: { value: 'Place 2', sourceId: 'test', timestamp: '' } } as Place,
      ]

      store.setSearchResults(places)

      expect(store.searchResults).toEqual(places)
      expect(store.lastResultCount).toBe(2)
      expect(store.hasResults).toBe(true)
      expect(store.searchError).toBeNull()
    })

    test('clears error when setting results', () => {
      const store = useSearchStore()
      store.setSearchError('Previous error')

      store.setSearchResults([])

      expect(store.searchError).toBeNull()
    })
  })

  describe('clearSearchResults', () => {
    test('clears all search state', () => {
      const store = useSearchStore()
      const places: Place[] = [
        { id: '1', name: { value: 'Place 1', sourceId: 'test', timestamp: '' } } as Place,
      ]

      store.setSearchResults(places)
      store.setLastMaxResults(100)
      store.setSearchError('Some error')
      store.setHoveredPlace('1')

      store.clearSearchResults()

      expect(store.searchResults).toEqual([])
      expect(store.lastResultCount).toBe(0)
      expect(store.lastMaxResults).toBeNull()
      expect(store.searchError).toBeNull()
      expect(store.hoveredPlaceId).toBeNull()
      expect(store.hasResults).toBe(false)
    })
  })

  describe('Loading state', () => {
    test('isLoading is true when searching', () => {
      const store = useSearchStore()

      store.setSearchLoading(true)

      expect(store.isSearching).toBe(true)
      expect(store.isLoading).toBe(true)
    })

    test('isLoading is true when map refreshing', () => {
      const store = useSearchStore()

      store.setMapRefreshing(true)

      expect(store.isMapRefreshing).toBe(true)
      expect(store.isLoading).toBe(true)
    })

    test('isLoading is true when both searching and refreshing', () => {
      const store = useSearchStore()

      store.setSearchLoading(true)
      store.setMapRefreshing(true)

      expect(store.isLoading).toBe(true)
    })

    test('isLoading is false when neither searching nor refreshing', () => {
      const store = useSearchStore()

      store.setSearchLoading(false)
      store.setMapRefreshing(false)

      expect(store.isLoading).toBe(false)
    })
  })

  describe('hitMaxResults', () => {
    test('is false when lastMaxResults is null', () => {
      const store = useSearchStore()
      const places: Place[] = [
        { id: '1', name: { value: 'Place 1', sourceId: 'test', timestamp: '' } } as Place,
      ]

      store.setSearchResults(places)

      expect(store.hitMaxResults).toBe(false)
    })

    test('is true when result count equals maxResults', () => {
      const store = useSearchStore()
      const places: Place[] = [
        { id: '1', name: { value: 'Place 1', sourceId: 'test', timestamp: '' } } as Place,
        { id: '2', name: { value: 'Place 2', sourceId: 'test', timestamp: '' } } as Place,
      ]

      store.setLastMaxResults(2)
      store.setSearchResults(places)

      expect(store.hitMaxResults).toBe(true)
    })

    test('is true when result count exceeds maxResults', () => {
      const store = useSearchStore()
      const places: Place[] = [
        { id: '1', name: { value: 'Place 1', sourceId: 'test', timestamp: '' } } as Place,
        { id: '2', name: { value: 'Place 2', sourceId: 'test', timestamp: '' } } as Place,
        { id: '3', name: { value: 'Place 3', sourceId: 'test', timestamp: '' } } as Place,
      ]

      store.setLastMaxResults(2)
      store.setSearchResults(places)

      expect(store.hitMaxResults).toBe(true)
    })

    test('is false when result count is less than maxResults', () => {
      const store = useSearchStore()
      const places: Place[] = [
        { id: '1', name: { value: 'Place 1', sourceId: 'test', timestamp: '' } } as Place,
      ]

      store.setLastMaxResults(10)
      store.setSearchResults(places)

      expect(store.hitMaxResults).toBe(false)
    })
  })

  describe('addSearchResult', () => {
    test('adds a new result', () => {
      const store = useSearchStore()
      const place: Place = { id: '1', name: { value: 'Place 1', sourceId: 'test', timestamp: '' } } as Place

      store.addSearchResult(place)

      expect(store.searchResults).toHaveLength(1)
      expect(store.searchResults[0]).toEqual(place)
    })

    test('does not add duplicate result', () => {
      const store = useSearchStore()
      const place: Place = { id: '1', name: { value: 'Place 1', sourceId: 'test', timestamp: '' } } as Place

      store.addSearchResult(place)
      store.addSearchResult(place)

      expect(store.searchResults).toHaveLength(1)
    })
  })

  describe('removeSearchResult', () => {
    test('removes a result by id', () => {
      const store = useSearchStore()
      const places: Place[] = [
        { id: '1', name: { value: 'Place 1', sourceId: 'test', timestamp: '' } } as Place,
        { id: '2', name: { value: 'Place 2', sourceId: 'test', timestamp: '' } } as Place,
      ]

      store.setSearchResults(places)
      store.removeSearchResult('1')

      expect(store.searchResults).toHaveLength(1)
      expect(store.searchResults[0].id).toBe('2')
    })

    test('does nothing if id not found', () => {
      const store = useSearchStore()
      const places: Place[] = [
        { id: '1', name: { value: 'Place 1', sourceId: 'test', timestamp: '' } } as Place,
      ]

      store.setSearchResults(places)
      store.removeSearchResult('999')

      expect(store.searchResults).toHaveLength(1)
    })
  })

  describe('Search metadata', () => {
    test('setSearchQuery updates query', () => {
      const store = useSearchStore()

      store.setSearchQuery('coffee')

      expect(store.searchQuery).toBe('coffee')
    })

    test('setSearchType updates type', () => {
      const store = useSearchStore()

      store.setSearchType('category')

      expect(store.searchType).toBe('category')
    })

    test('setLastSearchBounds updates bounds', () => {
      const store = useSearchStore()
      const bounds = { north: 1, south: 0, east: 1, west: 0 }

      store.setLastSearchBounds(bounds)

      expect(store.lastSearchBounds).toEqual(bounds)
    })

    test('setHoveredPlace updates hovered place id', () => {
      const store = useSearchStore()

      store.setHoveredPlace('place-123')

      expect(store.hoveredPlaceId).toBe('place-123')
    })
  })
})
