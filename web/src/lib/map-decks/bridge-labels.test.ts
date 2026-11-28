import { describe, expect, test } from 'vitest'
import { mercator } from './decks'
import { deckFootprints } from './footprints'
import { deckReach, deckStretches, encodeProfile, raisedLabelFeatures, raisedLabelLayer, raisedTileLabels, ridesBridges, stretchFootprints } from './bridge-labels'

/** A deck between lng 0.001 and 0.002 whose surface climbs 10 m per 0.001°. */
const surfaceAt = (lng: number) => (lng >= 0.001 && lng <= 0.002 ? 20 + (lng - 0.001) * 10_000 : null)

describe('deckStretches', () => {
  test('keeps only the stretch over the deck, with its heights', () => {
    const [stretch, ...rest] = deckStretches([[0, 0], [0.003, 0]], surfaceAt, 10)
    expect(rest).toEqual([])
    expect(stretch[0][0]).toBeGreaterThanOrEqual(0.001)
    expect(stretch.at(-1)![0]).toBeLessThanOrEqual(0.002)
    // Within one sample step's climb of the deck's ends.
    expect(Math.abs(stretch[0][2] - 20)).toBeLessThan(1)
    expect(Math.abs(stretch.at(-1)![2] - 30)).toBeLessThan(1)
  })

  test('splits a line that crosses two decks', () => {
    const twoDecks = (lng: number) => ((lng > 0.001 && lng < 0.002) || (lng > 0.003 && lng < 0.004) ? 15 : null)
    expect(deckStretches([[0, 0], [0.005, 0]], twoDecks, 10)).toHaveLength(2)
  })

  test('finds the decks either side of a line drawn down the median', () => {
    const carriageways = (_: number, lat: number) => (Math.abs(Math.abs(lat) - 0.00006) < 0.00002 ? 25 : null)
    const [stretch] = deckStretches([[0, 0], [0.001, 0]], carriageways, 10)
    expect(stretch.every(([, , h]) => h === 25)).toBe(true)
  })

  test('a line clear of every deck has none', () => {
    expect(deckStretches([[0.01, 0], [0.02, 0]], surfaceAt)).toEqual([])
  })
})

describe('ridesBridges', () => {
  const rides = ridesBridges([[[0, 0], [0.003, 0]]])

  test('a line along the bridge rides it, either way', () => {
    expect(rides([0.001, 0.00002], [1, 0])).toBe(true)
    expect(rides([0.001, 0.00002], [-1, 0.05])).toBe(true)
  })

  test('a line crossing beneath it does not', () => {
    expect(rides([0.001, 0], [0, 1])).toBe(false)
  })

  test('a line alongside it, past the deck, does not', () => {
    expect(rides([0.001, 0.0002], [1, 0])).toBe(false)
  })

  test('raises a name only where it rides', () => {
    const under = { properties: { name: 'Water St' }, geometry: { type: 'LineString' as const, coordinates: [[0.0015, -0.001], [0.0015, 0.001]] } }
    const bridges = ridesBridges([[[0.001, 0], [0.002, 0]]])
    const everywhere = { boxes: [[0.001, -0.001, 0.002, 0.001] as [number, number, number, number]], near: () => true }
    expect(raisedLabelFeatures([under], everywhere, () => 30, bridges)).toEqual([])
  })
})

test('encodeProfile writes the first point whole and the rest as deltas', () => {
  expect(encodeProfile([[-73.99, 40.7, 31.24], [-73.9899, 40.7001, 31.5]])).toBe('-739900000,407000000,312,1000,1000,315')
})

describe('raisedLabelFeatures', () => {
  const name = { type: 'Feature' as const, properties: { name: 'Brooklyn Bridge' }, geometry: { type: 'LineString' as const, coordinates: [[0, 0], [0.003, 0]] } }
  const decks = deckReach({ type: 'MultiPolygon', coordinates: [[[[0.001, -0.0001], [0.002, -0.0001], [0.002, 0.0001], [0.001, 0.0001], [0.001, -0.0001]]]] })

  test('copies the stretch over a deck with its profile and properties', () => {
    const [raised, ...rest] = raisedLabelFeatures([name], decks, surfaceAt)
    expect(rest).toEqual([])
    expect(raised.properties).toMatchObject({ name: 'Brooklyn Bridge', elevation: expect.stringMatching(/^\d+,0,2\d\d,/) })
  })

  test('copies a line repeated across tiles once', () => {
    expect(raisedLabelFeatures([name, name], decks, surfaceAt)).toHaveLength(1)
  })

  test('never samples a line clear of every deck', () => {
    const away = { ...name, geometry: { type: 'LineString' as const, coordinates: [[1, 1], [1.1, 1]] } }
    expect(raisedLabelFeatures([away], decks, () => { throw new Error('sampled') })).toEqual([])
  })
})

describe('deckReach', () => {
  const diagonal = deckFootprints([{ points: [mercator([-74, 40.7]), mercator([-73.99, 40.71])], edges: [6, 6] }])
  const reach = deckReach(diagonal)

  test('holds the ground along a deck and beside it', () => {
    expect(reach.near(-73.995, 40.705)).toBe(true)
    expect(reach.near(-73.995, 40.7051)).toBe(true)
  })

  test('leaves out the corners of a diagonal deck\'s box', () => {
    expect(reach.near(-73.991, 40.701)).toBe(false)
    expect(reach.near(-73.999, 40.709)).toBe(false)
  })

  test('never samples a line that crosses a deck\'s box clear of the deck', () => {
    const street = { type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: [[-73.992, 40.7005], [-73.9905, 40.702]] } }
    expect(raisedLabelFeatures([street], reach, () => { throw new Error('sampled') })).toEqual([])
  })
})

test('raisedTileLabels raises a name only along a bridge of its tile', () => {
  const along = { type: 'Feature' as const, properties: { name: 'Brooklyn Bridge' }, geometry: { type: 'LineString' as const, coordinates: [[0, 0], [0.003, 0]] } }
  const beneath = { type: 'Feature' as const, properties: { name: 'Water Street' }, geometry: { type: 'LineString' as const, coordinates: [[0.0015, -0.001], [0.0015, 0.001]] } }
  const road = (brunnel?: string) => ({ type: 'Feature' as const, properties: { brunnel }, geometry: along.geometry })
  const decks = deckReach({ type: 'MultiPolygon', coordinates: [[[[0.001, -0.0001], [0.002, -0.0001], [0.002, 0.0001], [0.001, 0.0001], [0.001, -0.0001]]]] })

  const raised = raisedTileLabels([road('bridge')], [along, beneath], decks, surfaceAt)
  expect(raised.transportation).toHaveLength(1)
  expect(raised.transportation_name.map(f => f.properties!.name)).toEqual(['Brooklyn Bridge'])
  expect(raisedTileLabels([road()], [along], decks, surfaceAt)).toEqual({ transportation: [], transportation_name: [] })
})

test('raisedLabelLayer reads the raised source with the profile', () => {
  const layer = raisedLabelLayer({ id: 'Road labels', type: 'symbol', source: 'openmaptiles', 'source-layer': 'transportation_name', layout: { 'text-field': '{name}' }, filter: ['==', 'class', 'trunk'] })
  expect(layer).toEqual({
    id: 'Road labels:raised',
    type: 'symbol',
    source: 'bridge-labels:transportation_name',
    layout: { 'text-field': '{name}', 'symbol-elevation-profile': ['get', 'elevation'] },
    filter: ['==', 'class', 'trunk'],
  })
})

test('stretchFootprints covers the ground under each raised stretch', () => {
  const [polygon, ...rest] = stretchFootprints([{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[0, 0], [0.001, 0]] } }]).coordinates
  expect(rest).toEqual([])
  const lats = polygon[0].map(([, lat]) => lat)
  expect(Math.min(...lats)).toBeLessThan(-0.00005)
  expect(Math.max(...lats)).toBeGreaterThan(0.00005)
})
