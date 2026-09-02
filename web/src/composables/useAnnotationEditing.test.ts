import { describe, it, expect, beforeEach, vi } from 'vitest'
import { computed, effectScope, nextTick, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { Position } from 'geojson'
import { useMapStore } from '@/stores/map.store'
import { useAnnotationEditing } from './useAnnotationEditing'
import type { CanvasAnnotation } from '@/types/canvas.types'

/**
 * Reshaping moves the positions that were clicked, never the geometry they
 * imply — so what these check is that a drag lands on the right position, and
 * that the shape's own nature survives it: a circle resizes rather than
 * moving, a rectangle keeps its three defining clicks.
 */

vi.mock('@/lib/route-snapping', () => ({
  RouteSnapAborted: class extends Error {},
  snapWaypointsToPath: vi.fn(async () => null),
}))

const fetchIsochroneBands = vi.fn(async () => ({ bands: [], meta: null }))
vi.mock('@/lib/isochrone-request', () => ({
  fetchIsochroneBands: (...args: unknown[]) => fetchIsochroneBands(...(args as [])),
}))

/** A projection with a metre roughly a pixel, so hit tests are easy to reason about. */
const SCALE = 100

function fakeMap() {
  const canvas = document.createElement('canvas')
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect
  const dragPan = { enabled: true, enable: vi.fn(), disable: vi.fn() }
  // jsdom has no pointer capture; the drag must not depend on it.
  canvas.setPointerCapture = vi.fn()
  canvas.releasePointerCapture = vi.fn()
  return {
    canvas,
    dragPan,
    project: (position: Position) => ({
      x: position[0] * SCALE,
      y: -position[1] * SCALE,
    }),
    unproject: (point: [number, number]) => ({
      lng: point[0] / SCALE,
      lat: -point[1] / SCALE,
    }),
    getCanvas: () => canvas,
  }
}

let map: ReturnType<typeof fakeMap>

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  map = fakeMap()
  useMapStore().setMapStrategy({ mapInstance: map } as never)
})

/** A pointer event jsdom will accept, carrying the fields the code reads. */
function pointer(type: string, x: number, y: number, pointerId = 1) {
  const event = new MouseEvent(type, {
    clientX: x,
    clientY: y,
    bubbles: true,
    cancelable: true,
  })
  Object.defineProperty(event, 'pointerId', { value: pointerId })
  return event
}

function editor(annotation: CanvasAnnotation, enabled = true) {
  const annotations = ref<CanvasAnnotation[]>([annotation])
  const selectedId = ref<string | null>(annotation.id)
  const patches: Partial<CanvasAnnotation>[] = []
  const scope = effectScope()
  const api = scope.run(() =>
    useAnnotationEditing({
      annotations,
      selectedId,
      enabled: computed(() => enabled),
      onChange: (id, patch) => {
        patches.push(patch)
        annotations.value = annotations.value.map(a =>
          a.id === id ? { ...a, ...patch } : a,
        )
      },
    }),
  )!
  return { ...api, annotations, selectedId, patches, dispose: () => scope.stop() }
}

/** Drag from one screen point to another, the way a hand would. */
function drag(from: [number, number], to: [number, number]) {
  map.canvas.dispatchEvent(pointer('pointerdown', ...from))
  window.dispatchEvent(pointer('pointermove', ...to))
  window.dispatchEvent(pointer('pointerup', ...to))
}

const line = (): CanvasAnnotation => ({
  id: 'an-1',
  tool: 'line',
  positions: [
    [0, 0],
    [2, 0],
  ],
  color: '#e11d48',
})

describe('useAnnotationEditing', () => {
  it('puts a handle on every position of the selected mark', async () => {
    const session = editor(line())
    await nextTick()

    expect(session.scene.value?.handles.map(h => h.kind)).toEqual([
      'vertex',
      'vertex',
      // The midpoint, offered so an edge can be split.
      'midpoint',
    ])
    session.dispose()
  })

  it('paints the mark in a colour a canvas can actually use', async () => {
    // The overlay is a 2D canvas: `strokeStyle = 'ruby'` is ignored outright,
    // so a mark being reshaped used to lose its colour on the way.
    const session = editor({ ...line(), color: 'ruby' })
    await nextTick()

    expect(session.scene.value?.color).toMatch(/^#|^rgb|^oklch|^oklab/)
    session.dispose()
  })

  it('keeps the mark the thickness the map draws it', async () => {
    const session = editor({ ...line(), strokeWidth: 12, strokeCap: 'square' })
    await nextTick()

    expect(session.scene.value?.width).toBe(12)
    expect(session.scene.value?.cap).toBe('square')
    session.dispose()
  })

  it('shows nothing while a drawing tool is armed', async () => {
    const session = editor(line(), false)
    await nextTick()

    expect(session.scene.value).toBeNull()
    session.dispose()
  })

  it('moves the position a dragged vertex stands for', async () => {
    const session = editor(line())
    await nextTick()

    drag([200, 0], [400, -100])

    expect(session.patches.at(-1)?.positions).toEqual([
      [0, 0],
      [4, 1],
    ])
    session.dispose()
  })

  it('ignores a press that lands nowhere near a handle', async () => {
    const session = editor(line())
    await nextTick()

    drag([900, 900], [950, 950])

    expect(session.patches).toEqual([])
    expect(map.dragPan.disable).not.toHaveBeenCalled()
    session.dispose()
  })

  it('holds the map still while a handle is being dragged', async () => {
    const session = editor(line())
    await nextTick()

    map.canvas.dispatchEvent(pointer('pointerdown', 0, 0))
    expect(map.dragPan.disable).toHaveBeenCalled()
    // The style must not draw the mark the overlay is drawing.
    expect(session.suppressedId.value).toBe('an-1')

    window.dispatchEvent(pointer('pointerup', 100, 0))
    expect(map.dragPan.enable).toHaveBeenCalled()
    expect(session.suppressedId.value).toBeNull()
    session.dispose()
  })

  it('turns a dragged midpoint into a vertex of its own', async () => {
    const session = editor(line())
    await nextTick()

    // The midpoint of (0,0)–(2,0) sits at screen x 100.
    drag([100, 0], [100, -300])

    expect(session.annotations.value[0].positions).toEqual([
      [0, 0],
      [1, 3],
      [2, 0],
    ])
    session.dispose()
  })

  it('resizes a circle rather than moving it', async () => {
    // Big enough that this projection puts its radius handle clear of its
    // centre — on a real map you would zoom in for the same reason.
    const session = editor({
      id: 'an-c',
      tool: 'circle',
      positions: [[0, 0]],
      radiusMeters: 20_000,
    })
    await nextTick()

    const handle = session.scene.value!.handles.find(h => h.kind === 'radius')!
    const at = map.project(handle.position)
    drag([at.x, at.y], [at.x + 40, at.y])

    const patch = session.patches.at(-1)!
    expect(patch.radiusMeters).toBeGreaterThan(20_000)
    expect(patch.positions).toBeUndefined()
    session.dispose()
  })

  it('picks the nearest handle when two sit on top of each other', async () => {
    const session = editor({
      id: 'an-c',
      tool: 'circle',
      positions: [[0, 0]],
      radiusMeters: 20_000,
    })
    await nextTick()

    const handle = session.scene.value!.handles.find(h => h.kind === 'radius')!
    const at = map.project(handle.position)
    // A press just inside the radius handle, but still within reach of the
    // centre: taking handles in order would move the circle instead.
    drag([at.x - 2, at.y], [at.x + 30, at.y])

    expect(session.patches.at(-1)?.radiusMeters).toBeDefined()
    expect(session.patches.at(-1)?.positions).toBeUndefined()
    session.dispose()
  })

  it('takes a vertex out on a double-click, if the shape can spare it', async () => {
    const session = editor({
      id: 'an-p',
      tool: 'polygon',
      positions: [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ],
    })
    await nextTick()

    map.canvas.dispatchEvent(pointer('dblclick', 200, 0))

    expect(session.annotations.value[0].positions).toEqual([
      [0, 0],
      [2, 2],
      [0, 2],
    ])
    session.dispose()
  })

  it('keeps a shape that cannot spare one intact', async () => {
    const session = editor({
      id: 'an-t',
      tool: 'polygon',
      positions: [
        [0, 0],
        [2, 0],
        [2, 2],
      ],
    })
    await nextTick()

    map.canvas.dispatchEvent(pointer('dblclick', 200, 0))

    expect(session.annotations.value[0].positions).toHaveLength(3)
    session.dispose()
  })

  it('ends a drag that was taken away rather than finished', async () => {
    const session = editor(line())
    await nextTick()
    map.canvas.dispatchEvent(pointer('pointerdown', 0, 0))
    expect(session.suppressedId.value).toBe('an-1')

    // Released outside the page: without this the mark would stay held out
    // of the style, invisible until a reload.
    window.dispatchEvent(new Event('blur'))

    expect(session.suppressedId.value).toBeNull()
    expect(map.dragPan.enable).toHaveBeenCalled()
    session.dispose()
  })

  it('carries an isochrone along under the pointer while it is moved', async () => {
    const session = editor({
      id: 'an-i',
      tool: 'isochrone',
      positions: [[0, 0]],
      isochrone: {
        geometry: [[[0, 0], [0, 1], [1, 1], [0, 0]]],
        mode: 'walk',
        minutes: 15,
      },
    })
    await nextTick()

    map.canvas.dispatchEvent(pointer('pointerdown', 0, 0))
    window.dispatchEvent(pointer('pointermove', 100, 0))

    // The engine has not answered yet; the old shape follows the origin
    // rather than blanking or staying behind.
    const ring = (session.scene.value?.shape as { geometry: { coordinates: number[][][] } })
      .geometry.coordinates[0]
    expect(ring[0][0]).toBeCloseTo(1, 5)

    window.dispatchEvent(pointer('pointerup', 100, 0))
    await nextTick()
    // And then it asks what is actually reachable from there.
    expect(fetchIsochroneBands).toHaveBeenCalled()
    session.dispose()
  })

  it('gives the map back when the editor closes mid-drag', async () => {
    const session = editor(line())
    await nextTick()
    map.canvas.dispatchEvent(pointer('pointerdown', 0, 0))

    session.dispose()

    expect(map.dragPan.enable).toHaveBeenCalled()
    // A stray move after teardown must not still be reshaping anything.
    window.dispatchEvent(pointer('pointermove', 500, 500))
    expect(session.patches).toEqual([])
  })
})
