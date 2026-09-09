import { describe, it, expect, vi, afterEach } from 'vitest'
import { resolveSpecBounds, resolveSourceBounds, sourceDataKey } from './bounds'
import { createLayerDraft } from './draft'

/**
 * The camera only moves when we actually know where the data is. Guessing
 * wrong is worse than not moving: a fit to world bounds throws the user out
 * to the globe, and a fit that fires on every keystroke makes the map
 * unusable while you type a URL.
 */

afterEach(() => vi.unstubAllGlobals())

function stubFetch(payload: unknown, ok = true) {
  const fetchMock = vi.fn(async () => ({
    ok,
    json: async () => payload,
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('resolveSpecBounds', () => {
  it('measures an inline GeoJSON document', async () => {
    const bounds = await resolveSpecBounds({
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', geometry: { type: 'Point', coordinates: [174.7, -41.3] }, properties: {} },
          { type: 'Feature', geometry: { type: 'Point', coordinates: [174.9, -41.1] }, properties: {} },
        ],
      },
    })

    expect(bounds).toEqual({
      minLng: 174.7,
      minLat: -41.3,
      maxLng: 174.9,
      maxLat: -41.1,
    })
  })

  it('fetches a GeoJSON URL and measures that', async () => {
    stubFetch({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [1, 2] },
      properties: {},
    })

    const bounds = await resolveSpecBounds({
      type: 'geojson',
      data: 'https://example.com/data.geojson',
    })

    expect(bounds).toEqual({ minLng: 1, minLat: 2, maxLng: 1, maxLat: 2 })
  })

  it('reads a TileJSON document for a tiled source', async () => {
    stubFetch({ bounds: [-1, -2, 3, 4] })

    const bounds = await resolveSpecBounds({
      type: 'raster',
      url: 'https://example.com/tiles.json',
    })

    expect(bounds).toEqual({ minLng: -1, minLat: -2, maxLng: 3, maxLat: 4 })
  })

  it('prefers bounds declared on the source over a fetch', async () => {
    const fetchMock = stubFetch({ bounds: [0, 0, 1, 1] })

    const bounds = await resolveSpecBounds({
      type: 'raster',
      url: 'https://example.com/tiles.json',
      bounds: [10, 20, 11, 21],
    })

    expect(bounds).toEqual({ minLng: 10, minLat: 20, maxLng: 11, maxLat: 21 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('takes an image overlay from its corner coordinates', async () => {
    const bounds = await resolveSpecBounds({
      type: 'image',
      url: 'https://example.com/overlay.png',
      coordinates: [
        [-1, 1],
        [1, 1],
        [1, -1],
        [-1, -1],
      ],
    })

    expect(bounds).toEqual({ minLng: -1, minLat: -1, maxLng: 1, maxLat: 1 })
  })

  it('treats world-spanning bounds as unknown rather than flying to the globe', async () => {
    stubFetch({ bounds: [-180, -85, 180, 85] })

    expect(
      await resolveSpecBounds({ type: 'raster', url: 'https://e/t.json' }),
    ).toBeNull()
  })

  it('says nothing for bare tile templates, which carry no extent', async () => {
    expect(
      await resolveSpecBounds({
        type: 'raster',
        tiles: ['https://e/{z}/{x}/{y}.png'],
      }),
    ).toBeNull()
  })

  it('leaves the camera alone when the document will not load', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))

    expect(
      await resolveSpecBounds({ type: 'raster', url: 'https://e/t.json' }),
    ).toBeNull()
  })

  it('leaves the camera alone for a malformed document', async () => {
    stubFetch({ nothing: true })

    expect(
      await resolveSpecBounds({ type: 'geojson', data: 'https://e/x.geojson' }),
    ).toBeNull()
  })
})

describe('resolveSourceBounds', () => {
  it('works from an editor draft', async () => {
    const draft = createLayerDraft('geojson')
    draft.source.mode = 'inline'
    draft.source.data = JSON.stringify({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [5, 6] },
      properties: {},
    })

    expect(await resolveSourceBounds(draft.source)).toEqual({
      minLng: 5,
      minLat: 6,
      maxLng: 5,
      maxLat: 6,
    })
  })
})

describe('sourceDataKey', () => {
  it('changes when the data changes', () => {
    const a = createLayerDraft('raster')
    a.source.tiles = ['https://a/{z}/{x}/{y}.png']
    const b = { ...a.source, tiles: ['https://b/{z}/{x}/{y}.png'] }

    expect(sourceDataKey(a.source)).not.toBe(sourceDataKey(b))
  })

  it('ignores everything that only affects how the data is drawn', () => {
    const draft = createLayerDraft('raster')
    draft.source.tiles = ['https://a/{z}/{x}/{y}.png']
    const restyled = {
      ...draft.source,
      attribution: '© Someone',
      minzoom: 4,
      tileSize: 512,
    }

    expect(sourceDataKey(restyled)).toBe(sourceDataKey(draft.source))
  })
})
