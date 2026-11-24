import { defineStore } from 'pinia'
import { shallowRef } from 'vue'

interface StackedSheet {
  id: string
  /** Paint layer; a sheet always sits above every sheet on a lower layer. */
  layer: number
  dismiss: () => void
}

/**
 * Open bottom sheets, bottom to top: by layer, then in the order they opened.
 * Each sheet recedes behind the ones above it, so only the top has focus.
 */
export const useSheetStackStore = defineStore('sheet-stack', () => {
  const sheets = shallowRef<StackedSheet[]>([])

  function push(sheet: StackedSheet) {
    const rest = sheets.value.filter(s => s.id !== sheet.id)
    const above = rest.findIndex(s => s.layer > sheet.layer)
    sheets.value = above < 0 ? [...rest, sheet] : [...rest.slice(0, above), sheet, ...rest.slice(above)]
  }

  function remove(id: string) {
    if (!sheets.value.some(s => s.id === id)) return
    sheets.value = sheets.value.filter(s => s.id !== id)
  }

  /** How many open sheets sit above this one; 0 for the top or a closed sheet. */
  function depthOf(id: string) {
    const index = sheets.value.findIndex(s => s.id === id)
    return index < 0 ? 0 : sheets.value.length - 1 - index
  }

  function dismissTop() {
    sheets.value.at(-1)?.dismiss()
  }

  return { sheets, push, remove, depthOf, dismissTop }
})
