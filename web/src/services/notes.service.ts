import { api } from '@/lib/api'
import { useNotesStore } from '@/stores/notes.store'
import type { OsmNote } from '@/types/notes.types'

export function useNotesService() {
  const store = useNotesStore()

  async function fetchNotesInBbox(bbox: string) {
    store.isLoading = true
    try {
      const response = await api.get<OsmNote[]>('/notes', {
        params: { bbox },
      })
      store.notes = response.data
      store.lastBbox = bbox
      return response.data
    } finally {
      store.isLoading = false
    }
  }

  async function fetchNote(id: number) {
    const response = await api.get<OsmNote>(`/notes/${id}`)
    const note = response.data

    // Update the note in the store array if it already exists
    const index = store.notes.findIndex(n => n.id === id)
    if (index !== -1) {
      store.notes[index] = note
    }

    return note
  }

  async function commentOnNote(id: number, text: string) {
    const response = await api.post<OsmNote>(`/notes/${id}/comment`, { text })
    const note = response.data

    const index = store.notes.findIndex(n => n.id === id)
    if (index !== -1) {
      store.notes[index] = note
    }

    return note
  }

  async function closeNote(id: number, text?: string) {
    const response = await api.post<OsmNote>(`/notes/${id}/close`, { text })
    const note = response.data

    const index = store.notes.findIndex(n => n.id === id)
    if (index !== -1) {
      store.notes[index] = note
    }

    return note
  }

  async function reopenNote(id: number, text?: string) {
    const response = await api.post<OsmNote>(`/notes/${id}/reopen`, { text })
    const note = response.data

    const index = store.notes.findIndex(n => n.id === id)
    if (index !== -1) {
      store.notes[index] = note
    }

    return note
  }

  async function createNote(lat: number, lng: number, text: string) {
    const response = await api.post<OsmNote>('/notes', { lat, lng, text })
    const note = response.data

    store.notes.push(note)

    return note
  }

  return {
    fetchNotesInBbox,
    fetchNote,
    commentOnNote,
    closeNote,
    reopenNote,
    createNote,
  }
}
