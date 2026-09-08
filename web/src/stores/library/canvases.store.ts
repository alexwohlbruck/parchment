import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useStorage } from '@vueuse/core'
import { isOfflineId } from '@/lib/sync/offline-id'
import type { Canvas } from '@/types/canvas.types'

/**
 * Canvases the user has built. Holds fully hydrated canvases — decrypted
 * display fields and decrypted body merged on by the canvases service.
 * Persisted to localStorage so the library and any canvases toggled onto the
 * map render instantly on reload, before the network refetch lands.
 */
export const useCanvasesStore = defineStore('canvases', () => {
  const canvases = useStorage<Canvas[]>('canvases', [])

  /**
   * Which canvases are drawn on the main map. Client-only and per-device:
   * a canvas being on the map is a view preference, not a property of the
   * canvas, and it should not follow the user to another browser.
   */
  const activeCanvasIds = useStorage<string[]>('canvases-active', [])

  /**
   * The canvas currently open in the editor. The editor draws its own working
   * copy, so the main map skips this one — otherwise both would render the
   * same layer ids and fight over them.
   */
  const editingCanvasId = ref<string | null>(null)

  const getCanvasById = computed(
    () => (id: string) => canvases.value.find(c => c.id === id),
  )

  const activeCanvases = computed(() =>
    activeCanvasIds.value
      .filter(id => id !== editingCanvasId.value)
      .map(id => canvases.value.find(c => c.id === id))
      .filter((c): c is Canvas => !!c),
  )

  function setCanvases(next: Canvas[]) {
    // Canvases created offline aren't on the server yet, so a refresh must
    // not drop them; their queued create replaces them once it replays.
    const pending = canvases.value.filter(
      c => isOfflineId(c.id) && !next.some(n => n.id === c.id),
    )
    canvases.value = [...pending, ...next]
  }

  /**
   * Swap an offline-created canvas for the server's version.
   *
   * The replayed create has already upserted the server row, so drop that
   * copy first — otherwise the temp row becomes a second, identical entry.
   */
  function replaceCanvas(oldId: string, canvas: Canvas) {
    const rest = canvases.value.filter(c => c.id !== canvas.id)
    const index = rest.findIndex(c => c.id === oldId)
    if (index !== -1) {
      rest[index] = canvas
      canvases.value = rest
    } else {
      canvases.value = [canvas, ...rest]
    }
    activeCanvasIds.value = [
      ...new Set(activeCanvasIds.value.map(id => (id === oldId ? canvas.id : id))),
    ]
  }

  function upsertCanvas(canvas: Canvas) {
    const index = canvases.value.findIndex(c => c.id === canvas.id)
    if (index !== -1) canvases.value[index] = canvas
    else canvases.value.unshift(canvas)
  }

  function removeCanvas(id: string) {
    canvases.value = canvases.value.filter(c => c.id !== id)
    activeCanvasIds.value = activeCanvasIds.value.filter(x => x !== id)
  }

  function setActive(id: string, active: boolean) {
    const without = activeCanvasIds.value.filter(x => x !== id)
    activeCanvasIds.value = active ? [...without, id] : without
  }

  function isActive(id: string) {
    return activeCanvasIds.value.includes(id)
  }

  function clearCache() {
    canvases.value = []
    activeCanvasIds.value = []
  }

  return {
    canvases,
    activeCanvasIds,
    editingCanvasId,
    activeCanvases,
    getCanvasById,
    setCanvases,
    upsertCanvas,
    replaceCanvas,
    removeCanvas,
    setActive,
    isActive,
    clearCache,
  }
})
