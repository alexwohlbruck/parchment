import { describe, test, expect } from 'vitest'
import { buildLayers, buildMapStyle, buildSatelliteStyle } from './build'
import { BASEMAP_CONTINENT_LABELS, GLOBE_CONTINENT_LABELS, GLOBE_NAMES, GLOBE_RELIEF_SOURCE, GLOBE_SOURCE } from './globe-layers'

const options = { tileServerUrl: 'https://tiles.test', theme: 'light', mapStyle: 'standard' } as any

describe.each(['light', 'dark'] as const)('%s globe layers', flavor => {
  const layers = buildLayers({ flavor }) as any[]
  const index = (id: string) => layers.findIndex(l => l.id === id)

  test('biomes sit on the bare ground, under every landcover and the water', () => {
    expect(index('Globe biome')).toBe(index('Background') + 1)
    expect(index('Globe biome')).toBeLessThan(index('Glacier'))
    expect(index('Globe biome')).toBeLessThan(index('Water'))
  })

  test('ocean depth, relief and lines draw over the water, under the borders', () => {
    const depth = index('Globe ocean depth')
    expect(depth).toBeGreaterThan(index('Water'))
    expect([index('Globe relief'), index('Globe lines')]).toEqual([depth + 1, depth + 2])
    expect(index('Globe lines')).toBeLessThan(index('Country border'))
  })

  test('continent names are placed before country names, so they win the space', () => {
    expect(index(GLOBE_CONTINENT_LABELS)).toBeGreaterThan(index('Country labels'))
  })

  test('the basemap keeps its sea names only once the globe has handed over', () => {
    expect(index(BASEMAP_CONTINENT_LABELS)).toBe(-1)
    expect(layers[index('Ocean labels')].minzoom).toBe(6)
    const globeNames = layers.filter(l => l['source-layer'] === GLOBE_NAMES)
    expect(globeNames.map(l => l.maxzoom).every((z: number) => z <= 6)).toBe(true)
  })

  test('names follow the chosen language, falling back to English', () => {
    const localized = buildLayers({ flavor, lang: 'de' }) as any[]
    const ocean = localized.find(l => l.id === 'Globe ocean labels')
    expect(ocean.layout['text-field']).toEqual(['coalesce', ['get', 'name:de'], ['get', 'name']])
  })
})

test('dark ice reads as land from orbit, and keeps the basemap colour up close', () => {
  const glacier = (flavor: 'light' | 'dark') => (buildLayers({ flavor }) as any[]).find(l => l.id === 'Glacier').paint['fill-color']
  expect(glacier('dark')).toEqual(['step', ['zoom'], expect.any(String), 6, expect.any(String)])
  expect(typeof glacier('light')).toBe('string')
})

describe('styles', () => {
  test('the street style carries both globe sources', () => {
    const style = buildMapStyle(options) as any
    expect(style.sources[GLOBE_SOURCE]).toMatchObject({ type: 'vector', maxzoom: 5 })
    expect(style.sources[GLOBE_RELIEF_SOURCE]).toMatchObject({ type: 'raster', tileSize: 256 })
  })

  test('hybrid keeps the globe names over the imagery, but none of its fills', () => {
    const style = buildSatelliteStyle({ ...options, hybrid: true, imagery: [] }) as any
    const globe = style.layers.filter((l: any) => l.source === GLOBE_SOURCE)
    expect(globe.length).toBeGreaterThan(0)
    expect(globe.every((l: any) => l.type === 'symbol' && l['source-layer'] === GLOBE_NAMES)).toBe(true)
    expect(style.sources[GLOBE_RELIEF_SOURCE]).toBeUndefined()
  })
})

test.each(['light', 'dark'] as const)('%s water starts the depth ramp on the globe and returns to the theme colour up close', flavor => {
  const water = (buildLayers({ flavor }) as any[]).find(l => l.id === 'Water').paint['fill-color']
  expect(water).toEqual(['interpolate', ['linear'], ['zoom'], 7, expect.any(String), 10, expect.any(String)])
  expect(water[4]).not.toBe(water[6])
})
