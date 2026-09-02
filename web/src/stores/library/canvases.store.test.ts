import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCanvasesStore } from './canvases.store'
import type { Canvas } from '@/types/canvas.types'

/**
 * Which canvases are on the map is a per-device view preference, and the one
 * open in the editor is deliberately excluded — the editor draws its own
 * working copy, and two renderers fighting over the same layer ids is the bug
 * this exists to prevent.
 */

function canvas(id: string): Canvas {
  return {
    id,
    userId: 'u1',
    scheme: 'server-key',
    isPublic: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    body: { layers: [] },
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

describe('useCanvasesStore', () => {
  it('keeps activation order, so the last one switched on draws on top', () => {
    const store = useCanvasesStore()
    store.setCanvases([canvas('a'), canvas('b')])

    store.setActive('a', true)
    store.setActive('b', true)

    expect(store.activeCanvases.map(c => c.id)).toEqual(['a', 'b'])
  })

  it('re-activating moves a canvas to the top rather than duplicating it', () => {
    const store = useCanvasesStore()
    store.setCanvases([canvas('a'), canvas('b')])
    store.setActive('a', true)
    store.setActive('b', true)

    store.setActive('a', true)

    expect(store.activeCanvasIds).toEqual(['b', 'a'])
  })

  it('skips the canvas open in the editor, which renders its own copy', () => {
    const store = useCanvasesStore()
    store.setCanvases([canvas('a'), canvas('b')])
    store.setActive('a', true)
    store.setActive('b', true)

    store.editingCanvasId = 'a'

    expect(store.activeCanvases.map(c => c.id)).toEqual(['b'])
    // Still switched on — it comes back the moment the editor closes.
    expect(store.activeCanvasIds).toContain('a')
  })

  it('ignores an active id whose canvas is gone', () => {
    const store = useCanvasesStore()
    store.setCanvases([canvas('a')])
    store.setActive('a', true)
    store.setActive('ghost', true)

    expect(store.activeCanvases.map(c => c.id)).toEqual(['a'])
  })

  it('drops a deleted canvas from the map as well as the list', () => {
    const store = useCanvasesStore()
    store.setCanvases([canvas('a')])
    store.setActive('a', true)

    store.removeCanvas('a')

    expect(store.canvases).toHaveLength(0)
    expect(store.activeCanvasIds).toEqual([])
  })

  it('upserts by id, so a refetch replaces rather than appends', () => {
    const store = useCanvasesStore()
    store.setCanvases([canvas('a')])

    store.upsertCanvas({ ...canvas('a'), name: 'Renamed' })

    expect(store.canvases).toHaveLength(1)
    expect(store.canvases[0].name).toBe('Renamed')
  })
})
