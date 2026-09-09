import { describe, it, expect, beforeEach, vi } from 'vitest'
import { effectScope } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useMapStore } from '@/stores/map.store'
import { useDrawingSurface } from './useDrawingSurface'

/**
 * The two things here that are more than a forwarding call: turning a
 * pointer event into a position on the ground, and asking the engine what it
 * drew around one. Both are measured against the canvas the map draws into,
 * which is what a bare `clientX` would get wrong the moment the map is not
 * flush with the window.
 */

function fakeMap(features: { properties?: Record<string, unknown> }[] = []) {
  const canvas = document.createElement('canvas')
  canvas.getBoundingClientRect = () =>
    ({ left: 100, top: 40 }) as DOMRect
  return {
    canvas,
    getCanvas: () => canvas,
    project: ([lng, lat]: number[]) => ({ x: lng, y: lat }),
    unproject: ([x, y]: [number, number]) => ({ lng: x, lat: y }),
    queryRenderedFeatures: vi.fn(() => features),
  }
}

function surface(map: unknown) {
  const scope = effectScope()
  return scope.run(() => {
    useMapStore().setMapStrategy({ mapInstance: map } as never)
    return useDrawingSurface()
  })!
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

describe('useDrawingSurface', () => {
  it('measures a pointer from the map, not from the window', () => {
    const api = surface(fakeMap())

    expect(api.positionAt({ clientX: 130, clientY: 60 })).toEqual([30, 20])
  })

  it('has an answer before the map does', () => {
    const api = surface(undefined)

    // A canvas can be open before the engine has finished loading.
    expect(api.positionAt({ clientX: 1, clientY: 1 })).toBeNull()
    expect(api.screenDistance([0, 0], [3, 4])).toBeNull()
    expect(api.idsAround([0, 0], 6)).toEqual([])
    expect(() => api.setPanning(true)).not.toThrow()
  })

  it('asks the engine for a box around the point, not the point itself', () => {
    const map = fakeMap([{ properties: { id: 'an-1' } }])
    const api = surface(map)

    // A hairline is otherwise almost unhittable.
    expect(api.idsAround([50, 20], 6)).toEqual(['an-1'])
    expect(map.queryRenderedFeatures).toHaveBeenCalledWith([
      [44, 14],
      [56, 26],
    ])
  })

  it('keeps only the ids of things that have one', () => {
    const api = surface(
      fakeMap([
        { properties: { id: 'an-1' } },
        // The basemap's own features come back too, and most carry no id.
        { properties: {} },
        { properties: { id: 42 } },
      ]),
    )

    expect(api.idsAround([0, 0], 6)).toEqual(['an-1'])
  })

  it('only clears the cursor it put there', () => {
    const map = fakeMap()
    const api = surface(map)

    map.canvas.style.cursor = 'crosshair'
    api.clearCursor('grab')
    expect(map.canvas.style.cursor).toBe('crosshair')

    api.setCursor('grab')
    api.clearCursor('grab')
    expect(map.canvas.style.cursor).toBe('')
  })
})
