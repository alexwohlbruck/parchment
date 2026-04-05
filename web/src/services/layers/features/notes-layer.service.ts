import { watch, toRaw } from 'vue'
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import { useNotesStore } from '@/stores/notes.store'
import { useNotesService } from '@/services/notes.service'
import type { MapStrategy } from '@/components/map/map-providers/map.strategy'
import NoteMapIcon from '@/components/map/NoteMapIcon.vue'
import type { OsmNote } from '@/types/notes.types'

const NOTE_MARKER_PREFIX = 'note-'

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

    // Watch layer visibility
    watch(
      () => notesStore.isLayerVisible,
      visible => {
        if (visible) {
          // Fetch notes for current viewport
          const bounds = mapStrategy.getBounds()
          if (bounds) {
            const bbox = `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`
            notesService.fetchNotesInBbox(bbox)
          }
        } else {
          // Remove all note markers
          mapStrategy.removeMarkersByPrefix(NOTE_MARKER_PREFIX)
          notesStore.notes = []
        }
      },
    )

    // Watch notes data and update markers
    watch(
      () => notesStore.notes,
      notes => {
        if (!notesStore.isLayerVisible) return
        updateNoteMarkers(mapStrategy, notes, router)
      },
      { deep: true },
    )

    // Listen for map move to refresh notes
    mapStrategy.mapInstance.on('moveend', () => {
      if (!notesStore.isLayerVisible) return
      const bounds = mapStrategy.getBounds()
      if (!bounds) return
      const bbox = `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`
      // Avoid refetching if bbox hasn't changed significantly
      if (bbox === notesStore.lastBbox) return
      notesService.fetchNotesInBbox(bbox)
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
      }
    }

    // Add/update markers
    for (const note of notes) {
      const markerId = `${NOTE_MARKER_PREFIX}${note.id}`
      if (mapStrategy.hasMarker(markerId)) continue

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
