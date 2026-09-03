import { describe, it, expect } from 'vitest'
import {
  buildCanvasesProjection,
  canvasIdFromLayerId,
  canvasLayerId,
  CANVASES_GROUP_ID,
} from './canvas-layers'
import { isVirtualLayerId } from './saved-places-layers'
import type { Canvas } from '@/types/canvas.types'

/**
 * Canvases are a projection, not rows — so what matters is that the selector
 * and the map never disagree, and that neither of them becomes a second place
 * where "is this canvas on" is decided.
 */

function canvas(id: string, over: Partial<Canvas> = {}): Canvas {
  return {
    id,
    userId: 'u',
    scheme: 'server-key',
    isPublic: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    name: id,
    ...over,
  } as Canvas
}

const build = (over: Partial<Parameters<typeof buildCanvasesProjection>[0]> = {}) =>
  buildCanvasesProjection({
    canvases: [],
    activeCanvasIds: [],
    activeCanvases: [],
    groupOverrides: {},
    groupLabel: 'Canvases',
    lockedLabel: 'Locked canvas',
    ...over,
  })

describe('the group', () => {
  it('is absent when there is nothing to put in it', () => {
    const p = build()
    expect(p.group).toBeNull()
    expect(p.layers).toEqual([])
  })

  it('appears once the user has a canvas, on by default', () => {
    const p = build({ canvases: [canvas('a')] })
    expect(p.group?.id).toBe(CANVASES_GROUP_ID)
    expect(p.group?.visible).toBe(true)
  })

  it('sorts above real groups but below saved places', () => {
    const p = build({ canvases: [canvas('a')] })
    // Real groups are non-negative; saved places is -2.
    expect(p.group!.order).toBeLessThan(0)
    expect(p.group!.order).toBeGreaterThan(-2)
  })

  it('is virtual, so the store never PATCHes a row for it', () => {
    const p = build({ canvases: [canvas('a')] })
    expect(p.group?.origin).toBe('virtual')
    expect(isVirtualLayerId(p.group!.id)).toBe(true)
    expect(p.layers.every(l => isVirtualLayerId(l.id))).toBe(true)
    expect(p.layers.every(l => l.origin === 'virtual')).toBe(true)
  })
})

describe('the rows', () => {
  it('list the most recently updated canvas first', () => {
    const p = build({
      canvases: [
        canvas('old', { updatedAt: '2026-01-01T00:00:00.000Z' }),
        canvas('new', { updatedAt: '2026-06-01T00:00:00.000Z' }),
      ],
    })
    expect(p.layers.map(l => l.name)).toEqual(['new', 'old'])
  })

  it('show a canvas as on when it is switched on', () => {
    const p = build({
      canvases: [canvas('a'), canvas('b')],
      activeCanvasIds: ['a'],
    })
    const row = (name: string) => p.layers.find(l => l.name === name)
    expect(row('a')?.visible).toBe(true)
    expect(row('b')?.visible).toBe(false)
  })

  it('keep reading as on while the whole group is off', () => {
    // The group is the thing that is off — switching it back on has to restore
    // exactly what was showing, so the rows must not be rewritten.
    const p = build({
      canvases: [canvas('a')],
      activeCanvasIds: ['a'],
      activeCanvases: [canvas('a')],
      groupOverrides: { [CANVASES_GROUP_ID]: false },
    })
    expect(p.layers[0].visible).toBe(true)
    expect(p.visibleIds).toEqual([])
  })

  it('name a canvas that will not decrypt rather than leaving it blank', () => {
    const p = build({ canvases: [canvas('a', { name: undefined })] })
    expect(p.layers[0].name).toBe('Locked canvas')
  })

  it('say how much is behind each toggle', () => {
    const p = build({
      canvases: [
        canvas('a', {
          body: {
            layers: [{ id: 'l1' }, { id: 'l2' }],
            annotations: [{ id: 'an1' }],
          } as never,
        }),
        canvas('b'),
      ],
    })
    expect(p.meta.get(canvasLayerId('a'))?.count).toBe(3)
    // No body loaded yet is zero, not a crash.
    expect(p.meta.get(canvasLayerId('b'))?.count).toBe(0)
  })

  it('carry the canvas own icon and colour to the row', () => {
    const p = build({
      canvases: [canvas('a', { icon: 'Map', iconColor: 'teal', iconPack: 'maki' })],
    })
    expect(p.layers[0].icon).toBe('Map')
    expect(p.meta.get(canvasLayerId('a'))).toMatchObject({
      iconPack: 'maki',
      iconColor: 'teal',
    })
  })
})

describe('what the map draws', () => {
  it('draws them in activation order, so the last one switched on is on top', () => {
    // The store owns this ordering; the projection must pass it through
    // untouched rather than re-deriving it from the canvas list.
    const p = build({
      canvases: [canvas('a'), canvas('b')],
      activeCanvasIds: ['b', 'a'],
      activeCanvases: [canvas('b'), canvas('a')],
    })
    expect(p.visibleIds).toEqual(['b', 'a'])
  })

  it('takes everything off the map when the group is switched off', () => {
    const p = build({
      canvases: [canvas('a'), canvas('b')],
      activeCanvasIds: ['a', 'b'],
      activeCanvases: [canvas('a'), canvas('b')],
      groupOverrides: { [CANVASES_GROUP_ID]: false },
    })
    expect(p.visibleIds).toEqual([])
  })

  it('draws nothing for a canvas that is listed but switched off', () => {
    const p = build({
      canvases: [canvas('a'), canvas('b')],
      activeCanvasIds: ['a'],
      activeCanvases: [canvas('a')],
    })
    expect(p.visibleIds).toEqual(['a'])
    expect(p.layers).toHaveLength(2)
  })
})

describe('layer ids', () => {
  it('round-trip to the canvas they came from', () => {
    expect(canvasIdFromLayerId(canvasLayerId('abc'))).toBe('abc')
  })

  it('do not claim a saved-places row', () => {
    expect(canvasIdFromLayerId('virtual:collection:abc')).toBeNull()
    expect(canvasIdFromLayerId('virtual:saved-places')).toBeNull()
    expect(canvasIdFromLayerId('some-real-layer')).toBeNull()
  })
})
