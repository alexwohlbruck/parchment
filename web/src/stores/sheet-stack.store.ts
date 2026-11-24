import { defineStore } from 'pinia'
import { shallowRef } from 'vue'

interface StackedSheet {
  id: string
  /** Paint layer; a sheet always sits above every sheet on a lower layer. */
  layer: number
  /** A page-level sheet beside the map. It never pushes the sheets beneath it back. */
  panel: boolean
  dismiss: () => void
}

/** Where the front sheet's top edge rests, and whether a finger is moving it. */
export interface SheetEdge {
  top: number
  dragging: boolean
}

/**
 * Open bottom sheets, bottom to top: by layer, then in the order they opened.
 * Each sheet recedes behind the non-panel sheets above it, so only the front
 * one has focus.
 */
export const useSheetStackStore = defineStore('sheet-stack', () => {
  const sheets = shallowRef<StackedSheet[]>([])
  const edges = shallowRef(new Map<string, SheetEdge>())

  function push(sheet: StackedSheet) {
    const rest = sheets.value.filter(s => s.id !== sheet.id)
    const above = rest.findIndex(s => s.layer > sheet.layer)
    sheets.value =
      above < 0
        ? [...rest, sheet]
        : [...rest.slice(0, above), sheet, ...rest.slice(above)]
  }

  function remove(id: string) {
    if (!sheets.value.some(s => s.id === id)) return
    sheets.value = sheets.value.filter(s => s.id !== id)
  }

  /** How many sheets above this one push it back; 0 for the front sheet or a closed one. */
  function depthOf(id: string) {
    const index = sheets.value.findIndex(s => s.id === id)
    if (index < 0) return 0
    return sheets.value.slice(index + 1).filter(s => !s.panel).length
  }

  /** The topmost sheet that pushes others back. */
  function front() {
    return sheets.value.filter(s => !s.panel).at(-1)
  }

  function setEdge(id: string, edge: SheetEdge) {
    const current = edges.value.get(id)
    if (current?.top === edge.top && current.dragging === edge.dragging) return
    edges.value = new Map(edges.value).set(id, edge)
  }

  function clearEdge(id: string) {
    if (!edges.value.has(id)) return
    const next = new Map(edges.value)
    next.delete(id)
    edges.value = next
  }

  function frontEdge() {
    const sheet = front()
    return sheet ? edges.value.get(sheet.id) : undefined
  }

  function dismissFront() {
    front()?.dismiss()
  }

  return {
    sheets,
    push,
    remove,
    depthOf,
    front,
    setEdge,
    clearEdge,
    frontEdge,
    dismissFront,
  }
})
