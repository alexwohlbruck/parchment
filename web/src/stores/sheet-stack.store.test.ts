import { describe, test, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSheetStackStore } from '@/stores/sheet-stack.store'

describe('useSheetStackStore', () => {
  beforeEach(() => setActivePinia(createPinia()))

  test('each sheet recedes by the number of sheets opened after it', () => {
    const stack = useSheetStackStore()
    stack.push({ id: 'home', layer: 0, dismiss: () => {} })
    stack.push({ id: 'place', layer: 0, dismiss: () => {} })
    stack.push({ id: 'collections', layer: 0, dismiss: () => {} })

    expect(stack.depthOf('home')).toBe(2)
    expect(stack.depthOf('place')).toBe(1)
    expect(stack.depthOf('collections')).toBe(0)
    expect(stack.depthOf('unknown')).toBe(0)
  })

  test('closing a sheet brings the ones beneath it forward', () => {
    const stack = useSheetStackStore()
    stack.push({ id: 'home', layer: 0, dismiss: () => {} })
    stack.push({ id: 'place', layer: 0, dismiss: () => {} })
    stack.remove('place')

    expect(stack.depthOf('home')).toBe(0)
  })

  test('reopening a sheet moves it to the top', () => {
    const stack = useSheetStackStore()
    stack.push({ id: 'home', layer: 0, dismiss: () => {} })
    stack.push({ id: 'place', layer: 0, dismiss: () => {} })
    stack.push({ id: 'home', layer: 0, dismiss: () => {} })

    expect(stack.sheets.map(s => s.id)).toEqual(['place', 'home'])
  })

  test('a sheet on a lower layer stays beneath, whenever it opened', () => {
    const stack = useSheetStackStore()
    stack.push({ id: 'place', layer: 0, dismiss: () => {} })
    stack.push({ id: 'home', layer: -10, dismiss: () => {} })

    expect(stack.depthOf('home')).toBe(1)
    expect(stack.depthOf('place')).toBe(0)
  })

  test('dismissTop closes only the topmost sheet', () => {
    const stack = useSheetStackStore()
    const below = vi.fn()
    const top = vi.fn()
    stack.push({ id: 'place', layer: 0, dismiss: below })
    stack.push({ id: 'collections', layer: 0, dismiss: top })
    stack.dismissTop()

    expect(top).toHaveBeenCalledOnce()
    expect(below).not.toHaveBeenCalled()
  })
})
