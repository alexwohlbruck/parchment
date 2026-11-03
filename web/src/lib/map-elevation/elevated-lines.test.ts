import { describe, test, expect } from 'vitest'
import { expression } from '@maplibre/maplibre-gl-style-spec'
import { ELEVATION_FORMAT, ELEVATION_PROFILE, STATION_ANCHOR, STATION_HEIGHT, elevatesLine, holdsWidth, raisesSymbol, seesThrough, withElevationFormat } from './elevated-lines'

describe('elevated lines', () => {
  test('are the cycling ways and the transit ribbons, tiled or copied out', () => {
    expect(elevatesLine({ id: 'Cycling lane left bridge', type: 'line', source: 'detail', sourceLayer: 'bicycle_ways' })).toBe(true)
    expect(elevatesLine({ id: 'portolan-ribbon-15-steady-nyc', type: 'line', source: 'portolan-tiles-nyc', sourceLayer: 'ribbons' })).toBe(true)
    expect(elevatesLine({ id: 'portolan-ribbon-15-transition', type: 'line', source: 'portolan-build-15' })).toBe(true)
  })

  test('leave the basemap, the route lines and anything not a line alone', () => {
    expect(elevatesLine({ id: 'Minor road', type: 'line', source: 'openmaptiles', sourceLayer: 'transportation' })).toBe(false)
    expect(elevatesLine({ id: 'route-0', type: 'line', source: 'route-0' })).toBe(false)
    expect(elevatesLine({ id: 'portolan-stations', type: 'symbol', source: 'portolan-tiles-nyc', sourceLayer: 'ribbons' })).toBe(false)
  })

  test('hold their width under tilt for the ribbons only', () => {
    expect(holdsWidth({ id: 'portolan-ribbon-15-steady-nyc', type: 'line', source: 'portolan-tiles-nyc', sourceLayer: 'ribbons' })).toBe(true)
    expect(holdsWidth({ id: 'portolan-ribbon-15-transition', type: 'line', source: 'portolan-build-15' })).toBe(true)
    expect(holdsWidth({ id: 'Cycling lane left bridge', type: 'line', source: 'detail', sourceLayer: 'bicycle_ways' })).toBe(false)
  })

  test('see through only the dimmed ribbon copies', () => {
    expect(seesThrough({ id: 'portolan-ribbon-15-steady-nyc-ghost', type: 'line' })).toBe(true)
    expect(seesThrough({ id: 'portolan-ribbon-15-steady-nyc', type: 'line' })).toBe(false)
  })

  test('profile reads the tile property, empty where a line has none', () => {
    const compiled = expression.createExpression(ELEVATION_PROFILE, { type: 'string' } as any) as any
    const profile = (properties: Record<string, unknown>) => compiled.value.evaluate({ zoom: 15 }, { type: 2, properties })
    expect(profile({ elevation: '0,0,10,5,5,20' })).toBe('0,0,10,5,5,20')
    expect(profile({})).toBe('')
  })

  test('tile urls name the heights they want, so an older cached tile is not used', () => {
    expect(withElevationFormat('/t/detail/{z}/{x}/{y}?v=1')).toBe(`/t/detail/{z}/{x}/{y}?v=1&elevation=${ELEVATION_FORMAT}`)
    expect(withElevationFormat('/p/nyc/{z}/{x}/{y}.mvt')).toBe(`/p/nyc/{z}/{x}/{y}.mvt?elevation=${ELEVATION_FORMAT}`)
  })

  test('stations stand at their ribbon\'s height, over the datum or the terrain, and on the ground without one', () => {
    expect(raisesSymbol({ id: 'portolan-station-markers', type: 'symbol', source: 'portolan-stations' })).toBe(true)
    expect(raisesSymbol({ id: 'Place labels', type: 'symbol', source: 'openmaptiles' })).toBe(false)
    const height = expression.createExpression(STATION_HEIGHT, { type: 'number' } as any) as any
    const anchor = expression.createExpression(STATION_ANCHOR, { type: 'string' } as any) as any
    const at = (properties: Record<string, unknown>) => [height, anchor].map(e => e.value.evaluate({ zoom: 15 }, { type: 1, properties }))
    expect(at({ elevation: '24.5' })).toEqual([24.5, 'absolute'])
    expect(at({ elevation: '~-9' })).toEqual([-9, 'ground'])
    expect(at({})).toEqual([0, 'ground'])
  })
})
