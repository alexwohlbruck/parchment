import { describe, expect, it } from 'vitest'
import { LayerType, type Layer, type LayerGroup } from '@/types/map.types'
import type { Bounds } from '@/types/offline.types'
import {
  countTilesByZoom,
  isEnumerableTemplate,
  latToTileY,
  lngToTileX,
  sourceTileUrls,
  boundsWidthKm,
  tileUrl,
} from './tiles'
import { BASEMAP_OPTION_ID, TERRAIN_OPTION_ID, buildLayerOptions, toOfflineSource } from './layer-options'
import { planRegion, regionUrls, scaledTileBytes } from './region-plan'
import { offlineCacheKey } from './offline-cache'

const MIDTOWN: Bounds = [-74.0, 40.74, -73.96, 40.77]

describe('tile math', () => {
  it('finds the tile under a point', () => {
    expect(lngToTileX(-73.9855, 14)).toBe(4824)
    expect(latToTileY(40.758, 14)).toBe(6157)
  })

  it('counts every tile of every zoom in the bounds', () => {
    const source = { kind: 'vector' as const, tiles: ['https://t/{z}/{x}/{y}'], minzoom: 0, maxzoom: 2 }
    expect(countTilesByZoom(source, MIDTOWN)).toEqual([
      { z: 0, count: 1 },
      { z: 1, count: 1 },
      { z: 2, count: 1 },
    ])
    expect([...sourceTileUrls(source, MIDTOWN)]).toEqual([
      'https://t/0/0/0',
      'https://t/1/0/0',
      'https://t/2/1/1',
    ])
  })

  it('skips sources whose own bounds miss the region', () => {
    const source = {
      kind: 'vector' as const,
      tiles: ['https://t/{z}/{x}/{y}'],
      minzoom: 0,
      maxzoom: 14,
      bounds: [2, 48, 3, 49] as Bounds,
    }
    expect(countTilesByZoom(source, MIDTOWN)).toEqual([])
  })

  it('fills templates the way MapLibre picks among them', () => {
    expect(tileUrl(['https://a/{z}/{x}/{y}', 'https://b/{z}/{x}/{y}'], 3, 1, 2)).toBe('https://b/3/1/2')
    expect(tileUrl(['https://t/{z}/{x}/{-y}.png'], 2, 1, 0)).toBe('https://t/2/1/3.png')
  })

  it('only enumerates z/x/y templates', () => {
    expect(isEnumerableTemplate('https://t/{z}/{x}/{y}?v=1')).toBe(true)
    expect(isEnumerableTemplate('https://t/{quadkey}.png')).toBe(false)
    expect(isEnumerableTemplate('https://t/{bbox-epsg-3857}')).toBe(false)
  })

  it('measures the width of the bounds across their middle', () => {
    expect(boundsWidthKm([-74, 40, -73, 41])).toBeCloseTo(85, 0)
  })
})

describe('offlineCacheKey', () => {
  it('drops the session token and keeps everything else', () => {
    expect(offlineCacheKey('https://api.test/proxy/barrelman/basemap/1/2/3?v=1&token=abc')).toBe(
      'https://api.test/proxy/barrelman/basemap/1/2/3?v=1',
    )
  })
})

describe('toOfflineSource', () => {
  it('caps zooms by kind', () => {
    expect(toOfflineSource({ type: 'vector', tiles: ['https://t/{z}/{x}/{y}'] })?.maxzoom).toBe(14)
    expect(toOfflineSource({ type: 'raster-dem', tiles: ['https://t/{z}/{x}/{y}'], maxzoom: 15 })?.maxzoom).toBe(12)
  })

  it('refuses hosts that forbid bulk saving, and untiled sources', () => {
    expect(toOfflineSource({ type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'] })).toBeNull()
    expect(toOfflineSource({ type: 'geojson' })).toBeNull()
    expect(toOfflineSource({ type: 'vector' })).toBeNull()
  })
})

const layer = (over: Partial<Layer>): Layer =>
  ({
    id: 'l',
    name: 'Layer',
    type: LayerType.CUSTOM,
    engine: [],
    showInLayerSelector: true,
    visible: false,
    order: 0,
    groupId: null,
    configuration: { id: 'l', type: 'line' as any, source: 'none' },
    ...over,
  }) as Layer

const group = (over: Partial<LayerGroup>): LayerGroup =>
  ({ id: 'g', name: 'Group', showInLayerSelector: true, visible: false, order: 0, userId: '', createdAt: '', updatedAt: '', ...over }) as LayerGroup

describe('buildLayerOptions', () => {
  const base = {
    styleSources: {
      basemap: { type: 'vector', tiles: ['https://api/proxy/barrelman/basemap/{z}/{x}/{y}'] },
      dem: { type: 'raster-dem', tiles: ['https://dem/{z}/{x}/{y}.webp'] },
      'portolan-nyc': { type: 'vector', tiles: ['https://api/proxy/portolan/nyc/{z}/{x}/{y}.mvt'] },
    },
    glyphs: 'https://app/fonts/{fontstack}/{range}.pbf',
    sprite: 'https://app/sprites/parchment',
    fontstacks: ['Geist Regular'],
    portolan: {
      base: 'https://api/proxy/portolan',
      feeds: [{ feed: 'nyc', maxzoom: 15, bounds: [-75, 40, -73, 41] }],
      tileQuery: (url: string) => url,
    },
  }

  it('always offers the basemap with its sprites and glyphs, and terrain separately', () => {
    const options = buildLayerOptions({ ...base, layers: [], groups: [] })
    const basemap = options.find(o => o.id === BASEMAP_OPTION_ID)!
    expect(basemap.required).toBe(true)
    expect(basemap.sources.map(s => s.tiles[0])).toEqual(['https://api/proxy/barrelman/basemap/{z}/{x}/{y}'])
    expect(basemap.files).toContain('https://app/sprites/parchment@2x.png')
    expect(basemap.files).toContain('https://app/fonts/Geist Regular/0-255.pbf')
    expect(options.find(o => o.id === TERRAIN_OPTION_ID)?.sources[0].kind).toBe('raster-dem')
  })

  it('keeps hidden layers and internal protocols out of the basemap', () => {
    const cycling = { type: 'vector', tiles: ['https://api/proxy/barrelman/cycling/{z}/{x}/{y}'] }
    const options = buildLayerOptions({
      ...base,
      styleSources: { ...base.styleSources, cycling, globe: { type: 'vector', tiles: ['globe://{z}/{x}/{y}'] } },
      groups: [],
      layers: [layer({ id: 'a', configuration: { id: 'a', type: 'line' as any, source: { id: 'cycling', ...cycling } as any } })],
    })
    expect(options[0].sources.map(s => s.tiles[0])).toEqual(['https://api/proxy/barrelman/basemap/{z}/{x}/{y}'])
  })

  it('offers a group with the sources of every layer beneath it', () => {
    const cycling = { type: 'vector', tiles: ['https://api/proxy/barrelman/cycling/{z}/{x}/{y}'], maxzoom: 16 }
    const options = buildLayerOptions({
      ...base,
      groups: [group({ id: 'bike', name: 'Cycling' }), group({ id: 'lanes', parentGroupId: 'bike' })],
      layers: [
        layer({ id: 'a', groupId: 'lanes', configuration: { id: 'a', type: 'line' as any, source: { id: 'c', ...cycling } as any } }),
        layer({ id: 'b', groupId: 'lanes', configuration: { id: 'b', type: 'line' as any, source: { id: 'c', ...cycling } as any } }),
      ],
    })
    const bike = options.find(o => o.id === 'bike')!
    expect(bike.sources).toHaveLength(1)
    expect(bike.sources[0].maxzoom).toBe(16)
  })

  it('adds the transit line pyramids to a transit group', () => {
    const options = buildLayerOptions({
      ...base,
      groups: [group({ id: 'transit', name: 'Transit' })],
      layers: [layer({ id: 't', type: LayerType.TRANSIT, groupId: 'transit' })],
    })
    const transit = options.find(o => o.id === 'transit')!
    expect(transit.sources[0].tiles[0]).toBe('https://api/proxy/portolan/nyc/{z}/{x}/{y}.mvt')
    expect(transit.sources[0].files).toEqual(['https://api/proxy/portolan/nyc/style.json'])
    expect(transit.files).toEqual(['https://api/proxy/portolan/index.json'])
    // The basemap must not claim the pyramids the transit layer mounted.
    expect(options[0].sources).toHaveLength(1)
  })

  it('leaves out layers with nothing to save', () => {
    const options = buildLayerOptions({
      ...base,
      groups: [],
      layers: [layer({ id: 'hill', configuration: { id: 'h', type: 'hillshade' as any, source: { id: 'm', type: 'raster-dem', url: 'mapbox://x' } as any } })],
    })
    expect(options.map(o => o.id)).toEqual([BASEMAP_OPTION_ID, TERRAIN_OPTION_ID])
  })
})

describe('planRegion', () => {
  const source = (id: string, bounds?: Bounds) => ({
    kind: 'vector' as const,
    tiles: [`https://t/${id}/{z}/{x}/{y}`],
    minzoom: 0,
    maxzoom: 2,
    ...(bounds ? { bounds } : {}),
    files: [`https://t/${id}/style.json`],
  })

  it('keeps only sources that reach the region, once each', () => {
    const plan = planRegion(MIDTOWN, [
      { id: 'a', name: 'A', sources: [source('nyc'), source('paris', [2, 48, 3, 49])], files: ['https://t/index.json'] },
      { id: 'b', name: 'B', sources: [source('nyc')], files: ['https://t/index.json'] },
    ])
    expect(plan.sources.map(s => s.tiles[0])).toEqual(['https://t/nyc/{z}/{x}/{y}'])
    expect(plan.files).toEqual(['https://t/index.json', 'https://t/nyc/style.json'])
    expect(plan.total).toBe(5)
    expect(plan.optionBytes.b).toBe(0)
    expect(plan.optionBytes.a).toBe(plan.estimatedBytes)
    expect([...regionUrls({ bounds: MIDTOWN, ...plan })]).toHaveLength(5)
  })
})

describe('scaledTileBytes', () => {
  it('grows a deep sample toward lower zooms, within what a tile can hold', () => {
    expect(scaledTileBytes(40_000, 16, 16)).toBe(20_000)
    expect(scaledTileBytes(40_000, 16, 14)).toBe(80_000)
    expect(scaledTileBytes(40_000, 16, 9)).toBe(500_000)
    expect(scaledTileBytes(0, 16, 16)).toBe(2_000)
  })
})
