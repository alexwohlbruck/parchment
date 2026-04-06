/**
 * Unit tests for notes store
 *
 * Tests cover:
 * - Tile-based caching (getUnloadedTileBboxes, markTilesLoaded)
 * - Note merging and deduplication
 * - Cache clearing
 * - Bbox filtering
 */

import { describe, test, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useNotesStore, parseBbox, bboxToString } from './notes.store'
import type { OsmNote } from '@/types/notes.types'

// Mock localStorage for test environment
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { store = {} },
    get length() { return Object.keys(store).length },
    key: (i: number) => Object.keys(store)[i] ?? null,
  }
})()
if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock })
}

function makeNote(overrides: Partial<OsmNote> = {}): OsmNote {
  return {
    id: 1,
    lat: 40.0,
    lng: -74.0,
    status: 'open',
    comments: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('parseBbox', () => {
  test('parses comma-separated bbox string', () => {
    const bbox = parseBbox('-74.1,40.0,-73.9,40.2')
    expect(bbox).toEqual({ west: -74.1, south: 40, east: -73.9, north: 40.2 })
  })
})

describe('bboxToString', () => {
  test('converts bbox object to string', () => {
    const str = bboxToString({ west: -74.1, south: 40, east: -73.9, north: 40.2 })
    expect(str).toBe('-74.1,40,-73.9,40.2')
  })
})

describe('useNotesStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  describe('mergeNotes', () => {
    test('adds new notes to the store', () => {
      const store = useNotesStore()
      const notes = [makeNote({ id: 1 }), makeNote({ id: 2 })]

      store.mergeNotes(notes)

      expect(store.notes).toHaveLength(2)
    })

    test('updates existing notes by ID (deduplication)', () => {
      const store = useNotesStore()
      store.mergeNotes([makeNote({ id: 1, status: 'open' })])
      store.mergeNotes([makeNote({ id: 1, status: 'closed' })])

      expect(store.notes).toHaveLength(1)
      expect(store.notes[0].status).toBe('closed')
    })

    test('enforces max cached notes limit', () => {
      const store = useNotesStore()
      const notes = Array.from({ length: 600 }, (_, i) =>
        makeNote({
          id: i + 1,
          createdAt: new Date(Date.now() - i * 1000).toISOString(),
        }),
      )

      store.mergeNotes(notes)

      // MAX_CACHED_NOTES is 500
      expect(store.notes.length).toBeLessThanOrEqual(500)
    })
  })

  describe('updateNote', () => {
    test('updates an existing note in place', () => {
      const store = useNotesStore()
      store.mergeNotes([makeNote({ id: 1, status: 'open' })])

      store.updateNote(makeNote({ id: 1, status: 'closed' }))

      expect(store.notes).toHaveLength(1)
      expect(store.notes[0].status).toBe('closed')
    })

    test('adds a new note if not found', () => {
      const store = useNotesStore()
      store.updateNote(makeNote({ id: 99 }))

      expect(store.notes).toHaveLength(1)
      expect(store.notes[0].id).toBe(99)
    })
  })

  describe('getNotesInBbox', () => {
    test('returns only notes within the bounding box', () => {
      const store = useNotesStore()
      store.mergeNotes([
        makeNote({ id: 1, lat: 40.1, lng: -74.0 }), // inside
        makeNote({ id: 2, lat: 50.0, lng: -74.0 }), // outside (too far north)
        makeNote({ id: 3, lat: 40.1, lng: -80.0 }), // outside (too far west)
      ])

      const result = store.getNotesInBbox({
        west: -75,
        south: 39,
        east: -73,
        north: 41,
      })

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe(1)
    })
  })

  describe('clearCache', () => {
    test('removes all notes and loaded tiles', () => {
      const store = useNotesStore()
      store.mergeNotes([makeNote({ id: 1 }), makeNote({ id: 2 })])
      store.markTilesLoaded({ west: -74, south: 40, east: -73, north: 41 })

      store.clearCache()

      expect(store.notes).toHaveLength(0)
    })

    test('subsequent fetches treat all tiles as unloaded after clear', () => {
      const store = useNotesStore()
      const bbox = { west: -74, south: 40, east: -73.5, north: 40.5 }

      // Mark tiles as loaded
      store.markTilesLoaded(bbox)
      const beforeClear = store.getUnloadedTileBboxes(bbox)
      expect(beforeClear).toHaveLength(0)

      // Clear cache
      store.clearCache()

      // Same tiles should now be unloaded
      const afterClear = store.getUnloadedTileBboxes(bbox)
      expect(afterClear.length).toBeGreaterThan(0)
    })
  })

  describe('getUnloadedTileBboxes', () => {
    test('returns tile bboxes for an unvisited area', () => {
      const store = useNotesStore()
      const bbox = { west: -74, south: 40, east: -73.5, north: 40.5 }

      const tiles = store.getUnloadedTileBboxes(bbox)
      expect(tiles.length).toBeGreaterThan(0)
    })

    test('returns empty array after tiles are marked loaded', () => {
      const store = useNotesStore()
      const bbox = { west: -74, south: 40, east: -73.5, north: 40.5 }

      // First call returns tiles to fetch
      const tiles = store.getUnloadedTileBboxes(bbox)
      expect(tiles.length).toBeGreaterThan(0)

      // Mark them loaded
      store.markTilesLoaded(bbox)

      // Second call returns empty (all cached)
      const tilesAfter = store.getUnloadedTileBboxes(bbox)
      expect(tilesAfter).toHaveLength(0)
    })
  })

  describe('selectedNote', () => {
    test('returns null when no note selected', () => {
      const store = useNotesStore()
      expect(store.selectedNote).toBeNull()
    })

    test('returns the selected note', () => {
      const store = useNotesStore()
      store.mergeNotes([makeNote({ id: 42 })])
      store.selectedNoteId = 42

      expect(store.selectedNote).not.toBeNull()
      expect(store.selectedNote!.id).toBe(42)
    })

    test('returns null when selected ID does not match any note', () => {
      const store = useNotesStore()
      store.mergeNotes([makeNote({ id: 1 })])
      store.selectedNoteId = 999

      expect(store.selectedNote).toBeNull()
    })
  })
})
