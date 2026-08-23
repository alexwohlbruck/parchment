import { describe, it, expect, beforeEach } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useMapStore } from '@/stores/map.store'
import { useCanvasMapSettings } from './useCanvasMapSettings'
import type { CanvasMapSettings } from '@/types/canvas.types'

/**
 * Overrides are applied by writing into the map settings themselves, so what
 * matters is that the user's own answers come back — including when the tab
 * went away before the canvas could hand them over.
 */

const CANVAS: CanvasMapSettings = {
  objects3d: false,
  terrain3d: true,
  hdRoads: true,
  indoorMaps: true,
  poiLabels: false,
  roadLabels: false,
  transitLabels: false,
  placeLabels: false,
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

function open(overrides: CanvasMapSettings | undefined) {
  const value = ref(overrides)
  const scope = effectScope()
  const api = scope.run(() => useCanvasMapSettings(value))!
  return { ...api, value, close: () => scope.stop() }
}

describe('useCanvasMapSettings', () => {
  it('leaves the app alone when a canvas has no appearance of its own', () => {
    const map = useMapStore()
    map.settings.poiLabels = true

    const canvas = open(undefined)

    expect(map.settings.poiLabels).toBe(true)
    expect(map.parkedSettings).toEqual({})
    canvas.close()
  })

  it('takes the map over while the canvas is open', () => {
    const map = useMapStore()
    map.settings.poiLabels = true
    map.settings.terrain3d = false

    const canvas = open(CANVAS)

    expect(map.settings.poiLabels).toBe(false)
    expect(map.settings.terrain3d).toBe(true)
    canvas.close()
  })

  it('hands the map back when the canvas closes', () => {
    const map = useMapStore()
    map.settings.poiLabels = true
    map.settings.terrain3d = false

    const canvas = open(CANVAS)
    canvas.close()

    expect(map.settings.poiLabels).toBe(true)
    expect(map.settings.terrain3d).toBe(false)
    expect(map.parkedSettings).toEqual({})
  })

  it('hands it back when the canvas stops overriding mid-session', async () => {
    const map = useMapStore()
    map.settings.roadLabels = true

    const canvas = open(CANVAS)
    expect(map.settings.roadLabels).toBe(false)

    canvas.value.value = undefined
    await Promise.resolve()

    expect(map.settings.roadLabels).toBe(true)
    canvas.close()
  })

  it('survives a round trip through storage', async () => {
    const map = useMapStore()
    map.settings.placeLabels = true
    const canvas = open(CANVAS)
    await nextTick()

    // The parked values are persisted, so they have to serialise as an
    // object rather than through a stringifier that flattens them.
    const stored = JSON.parse(
      localStorage.getItem('map-parked-settings') ?? 'null',
    )
    expect(stored?.placeLabels).toBe(true)
    canvas.close()
  })

  it('parks the originals so a lost tab cannot keep them', () => {
    const map = useMapStore()
    map.settings.placeLabels = true

    const canvas = open(CANVAS)

    // Persisted, so the next start can give them back even though this
    // session never got the chance to.
    expect(map.parkedSettings?.placeLabels).toBe(true)
    canvas.close()
  })
})
