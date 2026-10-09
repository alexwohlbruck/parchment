import { describe, expect, it } from 'vitest'
import { resolveHdRoads } from './hd-roads'
import { MapEngine } from '@/types/map.types'

describe('resolveHdRoads', () => {
  it('defaults on for MapLibre and off for Mapbox', () => {
    expect(resolveHdRoads(null, MapEngine.MAPLIBRE)).toBe(true)
    expect(resolveHdRoads(null, MapEngine.MAPBOX)).toBe(false)
    expect(resolveHdRoads(undefined, MapEngine.MAPLIBRE)).toBe(true)
  })

  it('respects an explicit choice on either engine', () => {
    expect(resolveHdRoads(false, MapEngine.MAPLIBRE)).toBe(false)
    expect(resolveHdRoads(true, MapEngine.MAPBOX)).toBe(true)
  })
})
