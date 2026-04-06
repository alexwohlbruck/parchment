import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useStorage } from '@vueuse/core'
import type { OsmNote } from '@/types/notes.types'
import { STORAGE_KEYS, jsonSerializer } from '@/lib/storage'

const CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours
const MAX_CACHED_NOTES = 500

/**
 * Grid-based tile size in degrees. We divide the world into fixed tiles
 * and track which tiles have been loaded.
 */
const TILE_SIZE = 0.5 // degrees

interface NotesCache {
  notes: Record<number, OsmNote>
  loadedTiles: Record<string, number> // tile key → timestamp
  updatedAt: number
}

interface NotesState {
  layerVisible: boolean
  cache: NotesCache
}

function emptyCache(): NotesCache {
  return { notes: {}, loadedTiles: {}, updatedAt: 0 }
}

export interface Bbox {
  west: number
  south: number
  east: number
  north: number
}

export function parseBbox(bbox: string): Bbox {
  const [west, south, east, north] = bbox.split(',').map(Number)
  return { west, south, east, north }
}

export function bboxToString(bbox: Bbox): string {
  return `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`
}

/** Get all tile keys that overlap a bbox */
function getTilesForBbox(bbox: Bbox): string[] {
  const tiles: string[] = []
  const minTx = Math.floor(bbox.west / TILE_SIZE)
  const maxTx = Math.floor(bbox.east / TILE_SIZE)
  const minTy = Math.floor(bbox.south / TILE_SIZE)
  const maxTy = Math.floor(bbox.north / TILE_SIZE)
  for (let tx = minTx; tx <= maxTx; tx++) {
    for (let ty = minTy; ty <= maxTy; ty++) {
      tiles.push(`${tx}:${ty}`)
    }
  }
  return tiles
}

/** Get the bbox for a single tile key */
function tileToBbox(tile: string): Bbox {
  const [tx, ty] = tile.split(':').map(Number)
  return {
    west: tx * TILE_SIZE,
    south: ty * TILE_SIZE,
    east: (tx + 1) * TILE_SIZE,
    north: (ty + 1) * TILE_SIZE,
  }
}

export const useNotesStore = defineStore('notes', () => {
  const stored = useStorage<NotesState>(
    STORAGE_KEYS.NOTES,
    { layerVisible: false, cache: emptyCache() },
    undefined,
    { serializer: jsonSerializer },
  )

  // Validate cache TTL on load
  function getValidCache(): NotesCache {
    const c = stored.value.cache
    if (!c || Date.now() - c.updatedAt > CACHE_TTL) {
      const empty = emptyCache()
      stored.value.cache = empty
      return empty
    }
    return c
  }

  const validCache = getValidCache()
  const notes = ref<OsmNote[]>(Object.values(validCache.notes))
  const selectedNoteId = ref<number | null>(null)
  const isLoading = ref(false)
  const isLayerVisible = computed({
    get: () => stored.value.layerVisible,
    set: (v: boolean) => { stored.value.layerVisible = v },
  })
  const lastBbox = ref<string | null>(null)
  const loadedTiles = ref<Record<string, number>>(validCache.loadedTiles)
  const selectedNote = computed(() => {
    if (selectedNoteId.value === null) return null
    return notes.value.find(note => note.id === selectedNoteId.value) ?? null
  })

  /**
   * Given a viewport bbox, returns tiles that need fetching,
   * each with its own bbox string for individual API calls.
   */
  function getUnloadedTileBboxes(viewportBbox: Bbox): string[] {
    const now = Date.now()
    const tiles = getTilesForBbox(viewportBbox)
    return tiles
      .filter(tile => {
        const ts = loadedTiles.value[tile]
        if (!ts) return true
        return now - ts > CACHE_TTL
      })
      .map(tile => bboxToString(tileToBbox(tile)))
  }

  function markTilesLoaded(fetchedBbox: Bbox) {
    const now = Date.now()
    const tiles = getTilesForBbox(fetchedBbox)
    for (const tile of tiles) {
      loadedTiles.value[tile] = now
    }
    // Prune expired tiles
    for (const key of Object.keys(loadedTiles.value)) {
      if (now - loadedTiles.value[key] > CACHE_TTL) {
        delete loadedTiles.value[key]
      }
    }
    persistCache()
  }

  function mergeNotes(incoming: OsmNote[]) {
    const noteMap = new Map(notes.value.map(n => [n.id, n]))
    for (const note of incoming) {
      noteMap.set(note.id, note)
    }

    // Enforce cap: keep newest notes by createdAt, evict oldest
    let allNotes = Array.from(noteMap.values())
    if (allNotes.length > MAX_CACHED_NOTES) {
      allNotes.sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
      allNotes = allNotes.slice(0, MAX_CACHED_NOTES)
    }

    notes.value = allNotes
    persistCache()
  }

  function updateNote(updatedNote: OsmNote) {
    const index = notes.value.findIndex(n => n.id === updatedNote.id)
    if (index !== -1) {
      notes.value[index] = updatedNote
    } else {
      notes.value.push(updatedNote)
      if (notes.value.length > MAX_CACHED_NOTES) {
        notes.value.sort((a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )
        notes.value = notes.value.slice(0, MAX_CACHED_NOTES)
      }
    }
    persistCache()
  }

  function persistCache() {
    const noteMap: Record<number, OsmNote> = {}
    for (const note of notes.value) {
      noteMap[note.id] = note
    }
    stored.value.cache = {
      notes: noteMap,
      loadedTiles: loadedTiles.value,
      updatedAt: Date.now(),
    }
  }

  function clearCache() {
    notes.value = []
    loadedTiles.value = {}
    stored.value.cache = emptyCache()
  }

  /** Get cached notes that fall within a given bbox */
  function getNotesInBbox(bbox: Bbox): OsmNote[] {
    return notes.value.filter(
      n => n.lng >= bbox.west && n.lng <= bbox.east && n.lat >= bbox.south && n.lat <= bbox.north,
    )
  }

  return {
    notes,
    selectedNoteId,
    selectedNote,
    isLoading,
    isLayerVisible,
    lastBbox,
    getUnloadedTileBboxes,
    markTilesLoaded,
    mergeNotes,
    updateNote,
    getNotesInBbox,
    clearCache,
  }
})
