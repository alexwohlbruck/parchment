import { describe, test, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSheetStackStore } from '@/stores/sheet-stack.store'

function sheet(id: string, opts: { layer?: number; panel?: boolean; dismiss?: () => void } = {}) {
  return { id, layer: opts.layer ?? 0, panel: opts.panel ?? false, dismiss: opts.dismiss ?? (() => {}) }
}

describe('useSheetStackStore', () => {
  beforeEach(() => setActivePinia(createPinia()))

  test('each sheet recedes by the number of stacked sheets above it', () => {
    const stack = useSheetStackStore()
    stack.push(sheet('place', { panel: true }))
    stack.push(sheet('collections'))
    stack.push(sheet('menu'))

    expect(stack.depthOf('place')).toBe(2)
    expect(stack.depthOf('collections')).toBe(1)
    expect(stack.depthOf('menu')).toBe(0)
    expect(stack.depthOf('unknown')).toBe(0)
  })

  test('a panel opened over another panel pushes nothing back', () => {
    const stack = useSheetStackStore()
    stack.push(sheet('home', { panel: true, layer: -10 }))
    stack.push(sheet('place', { panel: true }))

    expect(stack.depthOf('home')).toBe(0)
    expect(stack.front()).toBeUndefined()
  })

  test('closing a sheet brings the ones beneath it forward', () => {
    const stack = useSheetStackStore()
    stack.push(sheet('place', { panel: true }))
    stack.push(sheet('collections'))
    stack.remove('collections')

    expect(stack.depthOf('place')).toBe(0)
  })

  test('a sheet on a lower layer stays beneath, whenever it opened', () => {
    const stack = useSheetStackStore()
    stack.push(sheet('settings', { layer: 10 }))
    stack.push(sheet('menu'))

    expect(stack.front()?.id).toBe('settings')
    expect(stack.depthOf('menu')).toBe(1)
  })

  test('frontEdge reports only the front sheet', () => {
    const stack = useSheetStackStore()
    stack.push(sheet('collections'))
    stack.push(sheet('menu'))
    stack.setEdge('collections', { top: 300, dragging: false })
    stack.setEdge('menu', { top: 600, dragging: true })

    expect(stack.frontEdge()).toEqual({ top: 600, dragging: true })
  })

  test('dismissFront closes only the front sheet', () => {
    const stack = useSheetStackStore()
    const below = vi.fn()
    const front = vi.fn()
    stack.push(sheet('collections', { dismiss: below }))
    stack.push(sheet('menu', { dismiss: front }))
    stack.push(sheet('home', { panel: true, layer: -10 }))
    stack.dismissFront()

    expect(front).toHaveBeenCalledOnce()
    expect(below).not.toHaveBeenCalled()
  })
})
