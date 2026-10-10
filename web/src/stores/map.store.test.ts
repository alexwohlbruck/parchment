import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useMapStore } from './map.store'
import { MapEngine } from '@/types/map.types'

function storeWith(settings: Record<string, unknown>, flags: Record<string, string> = {}) {
  localStorage.setItem('map', JSON.stringify(settings))
  for (const [key, value] of Object.entries(flags)) localStorage.setItem(key, value)
  setActivePinia(createPinia())
  return useMapStore()
}

beforeEach(() => localStorage.clear())

describe('map store HD roads', () => {
  it('turns on for a new MapLibre install and stays off on Mapbox', () => {
    setActivePinia(createPinia())
    const map = useMapStore()
    expect(map.hdRoads).toBe(true)

    map.settings.engine = MapEngine.MAPBOX
    expect(map.hdRoads).toBe(false)
  })

  it('clears a stored false from the old default once', () => {
    const map = storeWith({ engine: MapEngine.MAPLIBRE, hdRoads: false })
    expect(map.settings.hdRoads).toBeNull()
    expect(map.hdRoads).toBe(true)
  })

  it('keeps a false chosen after the default changed', () => {
    const map = storeWith(
      { engine: MapEngine.MAPLIBRE, hdRoads: false },
      { 'map-hd-roads-default': 'true' },
    )
    expect(map.hdRoads).toBe(false)
  })

  it('keeps a stored true', () => {
    const map = storeWith({ engine: MapEngine.MAPBOX, hdRoads: true })
    expect(map.hdRoads).toBe(true)
  })
})
