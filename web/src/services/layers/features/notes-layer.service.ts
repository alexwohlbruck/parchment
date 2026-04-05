import { watch, toRaw } from 'vue'
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import { useNotesStore, parseBbox } from '@/stores/notes.store'
import { useNotesService } from '@/services/notes.service'
import type { MapStrategy } from '@/components/map/map-providers/map.strategy'
import NoteMapIcon from '@/components/map/NoteMapIcon.vue'
import type { OsmNote } from '@/types/notes.types'

const NOTE_MARKER_PREFIX = 'note-'
const OSM_MAX_BBOX_AREA = 25 // square degrees
const markerNoteStatus = new Map<string, string>()

function isBboxTooLarge(bounds: { north: number; south: number; east: number; west: number }): boolean {
  const width = Math.abs(bounds.east - bounds.west)
  const height = Math.abs(bounds.north - bounds.south)
  return width * height > OSM_MAX_BBOX_AREA
}

export function useNotesLayerService() {
  let reactivityInitialized = false
  const router = useRouter()

  function initializeNotesLayer(mapStrategy: MapStrategy) {
    if (!mapStrategy) return
    initializeReactivity(mapStrategy)
  }

  function initializeReactivity(mapStrategy: MapStrategy) {
    if (reactivityInitialized) return
    reactivityInitialized = true

    const notesStore = useNotesStore()
    const notesService = useNotesService()

    function getCurrentViewportBbox(): string | null {
      const bounds = mapStrategy.getBounds()
      if (!bounds || isBboxTooLarge(bounds)) return null
      return `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`
    }

    function showNotesForCurrentView() {
      const bbox = getCurrentViewportBbox()
      if (!bbox) {
        mapStrategy.removeMarkersByPrefix(NOTE_MARKER_PREFIX)
        return
      }
      const visibleNotes = notesStore.getNotesInBbox(parseBbox(bbox))
      updateNoteMarkers(mapStrategy, visibleNotes, router)
    }

    async function loadAndShowNotes() {
      const bbox = getCurrentViewportBbox()
      if (!bbox) {
        mapStrategy.removeMarkersByPrefix(NOTE_MARKER_PREFIX)
        return
      }
      await notesService.fetchNotesInBbox(bbox)
      showNotesForCurrentView()
    }

    // Watch layer visibility
    watch(
      () => notesStore.isLayerVisible,
      visible => {
        if (visible) {
          loadAndShowNotes()
        } else {
          mapStrategy.removeMarkersByPrefix(NOTE_MARKER_PREFIX)
          markerNoteStatus.clear()
        }
      },
    )

    // Watch notes data changes (e.g. status updates from detail panel)
    watch(
      () => notesStore.notes,
      () => {
        if (!notesStore.isLayerVisible) return
        showNotesForCurrentView()
      },
      { deep: true },
    )

    // Listen for map move to load & show notes
    mapStrategy.mapInstance.on('moveend', () => {
      if (!notesStore.isLayerVisible) return
      loadAndShowNotes()
    })
  }

  function updateNoteMarkers(
    mapStrategy: MapStrategy,
    notes: OsmNote[],
    router: ReturnType<typeof useRouter>,
  ) {
    if (!mapStrategy) return

    // Remove stale markers
    const currentNoteIds = new Set(notes.map(n => `${NOTE_MARKER_PREFIX}${n.id}`))
    const existingMarkerIds: string[] = []
    mapStrategy.markers.forEach((_, id) => {
      if (id.startsWith(NOTE_MARKER_PREFIX)) {
        existingMarkerIds.push(id)
      }
    })
    for (const markerId of existingMarkerIds) {
      if (!currentNoteIds.has(markerId)) {
        mapStrategy.removeMarker(markerId)
        markerNoteStatus.delete(markerId)
      }
    }

    // Add/update markers
    for (const note of notes) {
      const markerId = `${NOTE_MARKER_PREFIX}${note.id}`
      const existingStatus = markerNoteStatus.get(markerId)
      if (mapStrategy.hasMarker(markerId) && existingStatus === note.status) continue

      // Remove and re-create if status changed
      if (mapStrategy.hasMarker(markerId)) {
        mapStrategy.removeMarker(markerId)
      }
      markerNoteStatus.set(markerId, note.status)

      mapStrategy.addVueMarker(
        markerId,
        { lng: note.lng, lat: note.lat },
        NoteMapIcon,
        {
          note: toRaw(note),
          onClick: (_note: OsmNote) => {
            router.push({ name: AppRoute.NOTE, params: { id: String(_note.id) } })
          },
        },
      )
    }
  }

  return {
    initializeNotesLayer,
  }
}
