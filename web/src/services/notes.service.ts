import { api } from '@/lib/api'
import { useNotesStore, parseBbox } from '@/stores/notes.store'
import type { OsmNote } from '@/types/notes.types'

export function useNotesService() {
  const store = useNotesStore()

  /**
   * Fetch notes for a viewport bbox. Fetches each uncached tile individually
   * so the 100-note API limit applies per tile, not across the whole viewport.
   * Returns all cached notes within the viewport.
   */
  async function fetchNotesInBbox(bbox: string): Promise<OsmNote[]> {
    const viewportBbox = parseBbox(bbox)
    const tileBboxes = store.getUnloadedTileBboxes(viewportBbox)

    if (tileBboxes.length > 0) {
      store.isLoading = true
      try {
        // Fetch all uncached tiles in parallel
        const results = await Promise.all(
          tileBboxes.map(async tileBbox => {
            const response = await api.get<OsmNote[]>('/notes', {
              params: { bbox: tileBbox },
            })
            store.markTilesLoaded(parseBbox(tileBbox))
            return response.data
          }),
        )
        const allNotes = results.flat()
        if (allNotes.length > 0) {
          store.mergeNotes(allNotes)
        }
      } finally {
        store.isLoading = false
      }
    }

    store.lastBbox = bbox
    return store.getNotesInBbox(viewportBbox)
  }

  async function fetchNote(id: number) {
    const response = await api.get<OsmNote>(`/notes/${id}`)
    store.updateNote(response.data)
    return response.data
  }

  async function commentOnNote(id: number, text: string) {
    const response = await api.post<OsmNote>(`/notes/${id}/comment`, { text })
    store.updateNote(response.data)
    return response.data
  }

  async function closeNote(id: number, text?: string) {
    const response = await api.post<OsmNote>(`/notes/${id}/close`, { text })
    store.updateNote(response.data)
    return response.data
  }

  async function reopenNote(id: number, text?: string) {
    const response = await api.post<OsmNote>(`/notes/${id}/reopen`, { text })
    store.updateNote(response.data)
    return response.data
  }

  async function createNote(lat: number, lng: number, text: string) {
    const response = await api.post<OsmNote>('/notes/create', { lat, lng, text })
    store.updateNote(response.data)
    return response.data
  }

  /**
   * Force re-fetch notes for the last known viewport bbox (bypasses cache).
   */
  async function refreshNotes() {
    const bbox = store.lastBbox
    if (!bbox) return
    store.isLoading = true
    try {
      const response = await api.get<OsmNote[]>('/notes', {
        params: { bbox },
      })
      store.mergeNotes(response.data)
      store.markTilesLoaded(parseBbox(bbox))
    } finally {
      store.isLoading = false
    }
  }

  return {
    fetchNotesInBbox,
    fetchNote,
    commentOnNote,
    closeNote,
    reopenNote,
    createNote,
    refreshNotes,
  }
}
