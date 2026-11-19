import { describe, test, expect } from 'vitest'
import { featureFilter, validateStyleMin } from '@maplibre/maplibre-gl-style-spec'
import { buildMapStyle } from '@/lib/map-style/build'
import { clipLine, deckLabelFeatures, deckLabelLayer, deckPieces, isDeckName, offDecks, onDecks, tileBounds, type DeckHeightAt } from './deck-labels'
import { deckFootprints } from './footprints'
import { mercator } from './decks'

/** A deck running east along 40.7 from -74 to -73.99, rising 1 m every 10 m of longitude it covers. */
const ramp: DeckHeightAt = (lng, lat, along) => {
  if (Math.abs(lat - 40.7) > 0.0001 || lng < -74 || lng > -73.99) return null
  if (along && Math.abs(along[0]) < 0.9) return null
  return 50 + (lng + 74) * 8400 * 0.1
}

describe('deckPieces', () => {
  test('cuts a name at the deck ends, leaving its ground stretches without a height', () => {
    const pieces = deckPieces([[-74.002, 40.7], [-73.995, 40.7], [-73.995, 40.7], [-73.988, 40.7]], ramp, { tolerance: 100 })
    expect(pieces.map(p => p.height == null)).toEqual([true, false, true])
    expect(pieces[1].line[0][0]).toBeCloseTo(-74, 4)
    // The cut falls within a step of the deck end.
    expect(Math.abs(pieces[1].line.at(-1)![0] + 73.99)).toBeLessThan(0.0001)
    expect(pieces[1].height).toBeGreaterThan(50)
    expect(pieces[0].line.at(-1)).toEqual(pieces[1].line[0])
    expect(pieces[0].line[0]).toEqual([-74.002, 40.7])
    expect(pieces.at(-1)!.line.at(-1)).toEqual([-73.988, 40.7])
  })

  test('cuts a rising deck where it climbs past the tolerance, into stretches long enough for a name', () => {
    const pieces = deckPieces([[-74, 40.7], [-73.99, 40.7]], ramp, { tolerance: 2, minLength: 200 })
    expect(pieces.length).toBe(5)
    for (const [a, b] of pieces.slice(0, -1).map((p, i) => [p, pieces[i + 1]])) expect(b.height!).toBeGreaterThan(a.height!)
  })

  test('leaves a way crossing under a deck on the ground', () => {
    expect(deckPieces([[-73.995, 40.699], [-73.995, 40.701]], ramp)).toEqual([{ line: [[-73.995, 40.699], [-73.995, 40.701]], height: null }])
  })

  test('keeps a ground stretch to its own vertices', () => {
    expect(deckPieces([[-74.01, 40.69], [-74.005, 40.69], [-74.004, 40.691]], ramp)[0].line).toEqual([[-74.01, 40.69], [-74.005, 40.69], [-74.004, 40.691]])
  })
})

describe('clipLine', () => {
  const box: [number, number, number, number] = [0, 0, 10, 10]

  test('keeps the parts inside, split where the line leaves and comes back', () => {
    expect(clipLine([[-5, 5], [5, 5], [5, 15], [8, 5], [8, -5]], box)).toEqual([[[0, 5], [5, 5], [5, 10]], [[6.5, 10], [8, 5], [8, 0]]])
  })

  test('drops a line wholly outside', () => {
    expect(clipLine([[-5, -5], [-1, 20]], box)).toEqual([])
  })
})

test('tileBounds spans the tile in degrees', () => {
  const [w, s, e, n] = tileBounds(1, 1, 0)
  expect([w, e]).toEqual([0, 180])
  expect(s).toBeCloseTo(0)
  expect(n).toBeCloseTo(85.05, 1)
})

describe('offDecks', () => {
  const z = 16
  const [tx, ty] = mercator([-73.9995, 40.7]).map(v => Math.floor(v * 2 ** z))
  const at = (lng: number, lat: number) => {
    const [x, y] = mercator([lng, lat])
    return { x: (x * 2 ** z - tx) * 8192, y: (y * 2 ** z - ty) * 8192 }
  }
  const road = (from: [number, number], to: [number, number]) => ({ type: 2, properties: {}, geometry: [[at(...from), at(...to)]] }) as any
  const deck = (lat: number) => ({ points: [mercator([-74, lat]), mercator([-73.999, lat])], edges: [5, 5] })
  const footprint = deckFootprints([deck(40.7), deck(40.70001)])
  const off = featureFilter(offDecks(footprint), 'filter')
  const on = featureFilter(onDecks(footprint), 'filter')
  const shows = (feature: unknown) => off.filter({ zoom: 18 } as any, feature as any, { z, x: tx, y: ty } as any)

  test('takes off a name that runs onto a deck, and one wholly on two overlapping decks', () => {
    expect(shows(road([-74.0015, 40.7], [-73.9995, 40.7]))).toBe(false)
    expect(shows(road([-73.9998, 40.700005], [-73.9992, 40.700005]))).toBe(false)
  })

  test('leaves a name clear of the decks', () => {
    expect(shows(road([-73.9998, 40.701], [-73.9992, 40.701]))).toBe(true)
  })

  test('picks out exactly what it leaves out', () => {
    for (const feature of [road([-74.0015, 40.7], [-73.9995, 40.7]), road([-73.9998, 40.701], [-73.9992, 40.701])])
      expect(on.filter({ zoom: 18 } as any, feature, { z, x: tx, y: ty } as any)).toBe(!shows(feature))
  })
})

describe('deckLabelFeatures', () => {
  const [mx, my] = mercator([-73.995, 40.7])
  const tile: [number, number, number] = [14, Math.floor(mx * 2 ** 14), Math.floor(my * 2 ** 14)]

  test('cuts each name back to its tile and gives the deck stretches their height', () => {
    const [w, , e] = tileBounds(...tile)
    const { features } = deckLabelFeatures([{ geometry: { type: 'LineString', coordinates: [[w - 0.01, 40.7], [e + 0.01, 40.7]] }, properties: { name: 'Span' }, tile }], ramp)
    const xs = features.flatMap(f => (f.geometry as GeoJSON.LineString).coordinates.map(c => c[0]))
    expect(Math.min(...xs)).toBeCloseTo(w, 9)
    expect(Math.max(...xs)).toBeCloseTo(e, 9)
    expect(features.some(f => f.properties!.deck_height > 50)).toBe(true)
    expect(features.every(f => f.properties!.name === 'Span')).toBe(true)
  })

  test('raises a point on a deck and drops one belonging to the next tile', () => {
    const [, , e] = tileBounds(...tile)
    const { features } = deckLabelFeatures([
      { geometry: { type: 'Point', coordinates: [-73.995, 40.7] }, properties: {}, tile },
      { geometry: { type: 'Point', coordinates: [e + 0.001, 40.7] }, properties: {}, tile },
    ], ramp)
    expect(features).toHaveLength(1)
    expect(features[0].properties!.deck_height).toBeGreaterThan(50)
  })
})

describe('deckLabelLayer', () => {
  const style = buildMapStyle({ tileServerUrl: 'https://example.test/tiles', theme: 'light', hdRoads: true } as any)
  const names = (style.layers as any[]).filter(isDeckName)

  test('covers the road names and shields', () => {
    expect(names.map(l => l.id)).toEqual(expect.arrayContaining(['Road labels', 'Highway shield']))
  })

  test('draws each name layer from the cut names at their heights', () => {
    const layers = names.map(l => deckLabelLayer(l, l.filter))
    const errors = validateStyleMin({ ...style, sources: { ...style.sources, 'deck-labels': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } }, layers: [...(style.layers as any[]), ...layers] } as any)
    expect(errors.filter(e => /:deck/.test(e.message))).toEqual([])
    const road = layers.find(l => l.id === 'Road labels:deck') as any
    expect(road.source).toBe('deck-labels')
    expect(road['source-layer']).toBeUndefined()
    expect(road.layout['text-field']).toEqual((names.find(l => l.id === 'Road labels') as any).layout['text-field'])
    expect(road.layout['symbol-height-anchor']).toEqual(['case', ['has', 'deck_height'], 'absolute', 'ground'])
  })
})
