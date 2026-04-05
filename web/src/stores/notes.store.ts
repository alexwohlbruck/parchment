import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useStorage } from '@vueuse/core'
import type { OsmNote } from '@/types/notes.types'

export const useNotesStore = defineStore('notes', () => {
  const notes = ref<OsmNote[]>([])
  const selectedNoteId = ref<number | null>(null)
  const isLoading = ref(false)
  const isLayerVisible = useStorage<boolean>('notes-layer-visible', false)
  const lastBbox = ref<string | null>(null)

  const selectedNote = computed(() => {
    if (selectedNoteId.value === null) return null
    return notes.value.find(note => note.id === selectedNoteId.value) ?? null
  })

  return {
    notes,
    selectedNoteId,
    selectedNote,
    isLoading,
    isLayerVisible,
    lastBbox,
  }
})
