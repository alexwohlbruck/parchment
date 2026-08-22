import { describe, it, expect } from 'vitest'
import {
  createLayerDraft,
  layerToDraft,
  draftToConfiguration,
  draftToSourceSpec,
  validateDraft,
  withGeneratedIds,
  slugify,
  parseGeoJson,
} from './draft'
import { inferLayerKind } from './spec'
import { MapEngine, type Layer } from '@/types/map.types'

/**
 * The draft is the only thing standing between a form and a style layer, so
 * the round-trip has to be lossless: whatever the editor doesn't understand
 * still has to come back out the other side.
 */

function rasterLayer(overrides: Record<string, unknown> = {}): Layer {
  return {
    id: 'abc',
    name: 'Aerial',
    engine: [MapEngine.MAPLIBRE],
    showInLayerSelector: true,
    visible: true,
    order: 0,
    groupId: null,
    configuration: {
      id: 'aerial',
      type: 'raster',
      source: {
        id: 'aerial-source',
        type: 'raster',
        tiles: ['https://tiles.example/{z}/{x}/{y}.png'],
        tileSize: 256,
      },
      paint: { 'raster-opacity': 0.8 },
      ...overrides,
    },
  } as unknown as Layer
}

describe('layerToDraft', () => {
  it('pulls the source out of the configuration', () => {
    const draft = layerToDraft(rasterLayer())

    expect(draft.source.kind).toBe('raster')
    expect(draft.source.mode).toBe('tiles')
    expect(draft.source.tiles).toEqual(['https://tiles.example/{z}/{x}/{y}.png'])
    expect(draft.paint).toEqual({ 'raster-opacity': 0.8 })
  })

  it('reads a TileJSON source as a URL rather than tiles', () => {
    const draft = layerToDraft(
      rasterLayer({
        source: { id: 's', type: 'vector', url: 'https://example/tiles.json' },
      }),
    )

    expect(draft.source.mode).toBe('tilejson')
    expect(draft.source.url).toBe('https://example/tiles.json')
  })

  it('tells an inline GeoJSON document from a GeoJSON URL', () => {
    const inline = layerToDraft(
      rasterLayer({
        type: 'circle',
        source: {
          id: 's',
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        },
      }),
    )
    const remote = layerToDraft(
      rasterLayer({
        type: 'circle',
        source: { id: 's', type: 'geojson', data: 'https://example/x.geojson' },
      }),
    )

    expect(inline.source.mode).toBe('inline')
    expect(JSON.parse(inline.source.data)).toEqual({
      type: 'FeatureCollection',
      features: [],
    })
    expect(remote.source.mode).toBe('url')
    expect(remote.source.url).toBe('https://example/x.geojson')
  })

  it('keeps configuration keys it has no control for', () => {
    const draft = layerToDraft(rasterLayer({ slot: 'middle', metadata: { a: 1 } }))

    expect(draft.extra).toEqual({ slot: 'middle', metadata: { a: 1 } })
    expect(draftToConfiguration(draft).slot).toBe('middle')
  })
})

describe('draftToConfiguration', () => {
  it('round-trips a layer without losing anything', () => {
    const original = rasterLayer({ slot: 'top', minzoom: 4, filter: ['==', 'a', 1] })
    const configuration = draftToConfiguration(layerToDraft(original))

    expect(configuration).toEqual(original.configuration)
  })

  it('drops empty paint and layout bags rather than writing {}', () => {
    const draft = createLayerDraft('raster')
    draft.layerId = 'x'
    draft.source.id = 'x-source'
    draft.source.tiles = ['https://a/{z}/{x}/{y}.png']

    const configuration = draftToConfiguration(draft)

    expect(configuration.paint).toBeUndefined()
    expect(configuration.layout).toBeUndefined()
  })

  it('only writes source-layer for vector sources', () => {
    const vector = createLayerDraft('vector')
    vector.sourceLayer = 'roads'
    expect(draftToConfiguration(vector)['source-layer']).toBe('roads')

    const geojson = createLayerDraft('geojson')
    geojson.sourceLayer = 'roads'
    expect(draftToConfiguration(geojson)['source-layer']).toBeUndefined()
  })

  it('trims blank tile inputs, which the editor keeps around for the next row', () => {
    const draft = createLayerDraft('raster')
    draft.source.tiles = ['https://a/{z}/{x}/{y}.png', '  ', '']

    expect(draftToSourceSpec(draft.source).tiles).toEqual([
      'https://a/{z}/{x}/{y}.png',
    ])
  })

  it('falls back to an empty collection when inline GeoJSON will not parse', () => {
    const draft = createLayerDraft('geojson')
    draft.source.mode = 'inline'
    draft.source.data = '{ not json'

    expect(draftToSourceSpec(draft.source).data).toEqual({
      type: 'FeatureCollection',
      features: [],
    })
  })
})

describe('validateDraft', () => {
  function validRaster() {
    const draft = createLayerDraft('raster')
    draft.name = 'Aerial'
    draft.source.tiles = ['https://a/{z}/{x}/{y}.png']
    return draft
  }

  it('passes a complete raster layer', () => {
    expect(validateDraft(validRaster())).toEqual([])
  })

  it('requires a name', () => {
    const draft = validRaster()
    draft.name = '   '

    expect(validateDraft(draft)).toContainEqual({
      field: 'name',
      message: 'nameRequired',
    })
  })

  it('rejects a tile URL with no {z} placeholder', () => {
    const draft = validRaster()
    draft.source.tiles = ['https://a/tiles.png']

    expect(validateDraft(draft)).toContainEqual({
      field: 'source.tiles',
      message: 'tileTemplate',
    })
  })

  it('requires a source layer for vector tiles', () => {
    const draft = createLayerDraft('vector')
    draft.name = 'Roads'
    draft.source.url = 'https://example/tiles.json'

    expect(validateDraft(draft)).toContainEqual({
      field: 'sourceLayer',
      message: 'sourceLayerRequired',
    })
  })

  it('rejects inline GeoJSON that will not parse', () => {
    const draft = createLayerDraft('geojson')
    draft.name = 'Points'
    draft.source.mode = 'inline'
    draft.source.data = '{'

    expect(validateDraft(draft)).toContainEqual({
      field: 'source.data',
      message: 'invalidGeoJson',
    })
  })

  it('catches a zoom range that is the wrong way round', () => {
    const draft = validRaster()
    draft.minzoom = 12
    draft.maxzoom = 4

    expect(validateDraft(draft)).toContainEqual({
      field: 'minzoom',
      message: 'zoomRange',
    })
  })
})

describe('ids', () => {
  it('derives ids from the layer name so the user never types one', () => {
    const draft = withGeneratedIds({ ...createLayerDraft(), name: 'NZ Aerial!' }, 'x')

    expect(draft.layerId).toBe('nz-aerial')
    expect(draft.source.id).toBe('nz-aerial-source')
  })

  it('leaves ids the user (or an import) already set', () => {
    const base = createLayerDraft()
    base.name = 'Renamed'
    base.layerId = 'original-id'
    base.source.id = 'original-source'

    const draft = withGeneratedIds(base, 'x')

    expect(draft.layerId).toBe('original-id')
    expect(draft.source.id).toBe('original-source')
  })

  it('falls back when a name has nothing sluggable in it', () => {
    expect(slugify('!!!', 'layer-7')).toBe('layer-7')
  })
})

describe('parseGeoJson', () => {
  it('returns null for blanks and broken documents', () => {
    expect(parseGeoJson('')).toBeNull()
    expect(parseGeoJson('{')).toBeNull()
    expect(parseGeoJson('"a string"')).toBeNull()
  })
})

describe('inferLayerKind', () => {
  const point = { type: 'Point', coordinates: [0, 0] }
  const line = { type: 'LineString', coordinates: [[0, 0], [1, 1]] }
  const polygon = {
    type: 'Polygon',
    coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]],
  }

  function collection(...geometries: unknown[]) {
    return {
      type: 'FeatureCollection',
      features: geometries.map(geometry => ({
        type: 'Feature',
        geometry,
        properties: {},
      })),
    }
  }

  it('picks the renderer that will actually draw the data', () => {
    expect(inferLayerKind(collection(point, point))).toBe('circle')
    expect(inferLayerKind(collection(line))).toBe('line')
    expect(inferLayerKind(collection(polygon))).toBe('fill')
  })

  it('handles a bare geometry and a bare feature', () => {
    expect(inferLayerKind(point)).toBe('circle')
    expect(inferLayerKind({ type: 'Feature', geometry: line, properties: {} })).toBe('line')
  })

  it('reads multi-geometries as their singular form', () => {
    expect(inferLayerKind(collection({ type: 'MultiPolygon', coordinates: [] }))).toBe('fill')
    expect(inferLayerKind(collection({ type: 'MultiPoint', coordinates: [] }))).toBe('circle')
  })

  it('takes the majority in a mixed document', () => {
    expect(inferLayerKind(collection(point, polygon, polygon))).toBe('fill')
  })

  it('looks inside a geometry collection', () => {
    expect(
      inferLayerKind(collection({ type: 'GeometryCollection', geometries: [line, line] })),
    ).toBe('line')
  })

  it('returns null when there is nothing to go on, leaving the default alone', () => {
    expect(inferLayerKind(collection())).toBeNull()
    expect(inferLayerKind(null)).toBeNull()
    expect(inferLayerKind({ nonsense: true })).toBeNull()
  })
})
