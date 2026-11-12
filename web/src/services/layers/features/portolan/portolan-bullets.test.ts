/**
 * The panel must draw the bullet the map drew. That means the curated
 * shape, colour and label portolan resolved while building — and the id
 * matching that makes them findable from a routing engine's vocabulary.
 */
import { describe, test, expect, beforeEach } from 'vitest'
import {
  bulletFor,
  ensureBulletsAt,
  feedsAt,
  resetPortolanBullets,
  setPortolanRouteIndex,
  withCuratedLineColors,
} from './portolan-bullets'

const NYC = { feed: 'northeast-corridor', maxzoom: 18, bounds: [-75.8, 39.3, -71.9, 42.2] }
const SUBWAY = { feed: 'mta-subway', maxzoom: 18, bounds: [-74.26, 40.49, -73.7, 40.92] }
const MEXICO = { feed: 'mexico', maxzoom: 18, bounds: [-99.4, 19.1, -98.9, 19.6] }

const BROOKLYN = { lat: 40.68, lng: -73.98 }
const CDMX = { lat: 19.43, lng: -99.13 }

beforeEach(() => resetPortolanBullets([NYC, SUBWAY, MEXICO]))

describe('finding the pyramid that knows', () => {
  test('the tightest covering feed comes first', () => {
    // a Brooklyn station asks the subway before the whole corridor
    expect(feedsAt(BROOKLYN.lat, BROOKLYN.lng)).toEqual(['mta-subway', 'northeast-corridor'])
  })

  test('a place no pyramid covers asks nothing', () => {
    expect(feedsAt(-33.86, 151.2)).toEqual([]) // Sydney
  })

  test('loading is safe with no coordinates at all', async () => {
    await expect(ensureBulletsAt(undefined, undefined)).resolves.toBeUndefined()
  })
})

describe('the curated bullet', () => {
  test('is the map’s shape, colour and label', () => {
    setPortolanRouteIndex('mexico', {
      B_CMX0200L2: { label: '2', color: '0071C1', shape: 'notch', mode: 'metro' },
    })
    expect(bulletFor('B_CMX0200L2', CDMX.lat, CDMX.lng)).toEqual({
      label: '2', color: '0071C1', shape: 'notch', mode: 'metro',
    })
  })

  test('is found through a group pyramid’s prefix', () => {
    // the panel has "2" from the routing engine; the tile calls it "f3:2"
    setPortolanRouteIndex('northeast-corridor', {
      'f3:2': { label: '2', color: 'D82233' },
    })
    expect(bulletFor('2', BROOKLYN.lat, BROOKLYN.lng)?.color).toBe('D82233')
  })

  test('the tightest pyramid wins when both know the id', () => {
    setPortolanRouteIndex('northeast-corridor', { 'f3:2': { label: '2', color: 'AAAAAA' } })
    setPortolanRouteIndex('mta-subway', { '2': { label: '2', color: 'D82233' } })
    expect(bulletFor('2', BROOKLYN.lat, BROOKLYN.lng)?.color).toBe('D82233')
  })

  test('an exact id beats another feed’s prefixed one', () => {
    setPortolanRouteIndex('mta-subway', {
      'f9:2': { label: 'wrong', color: '000000' },
      '2': { label: '2', color: 'D82233' },
    })
    expect(bulletFor('2', BROOKLYN.lat, BROOKLYN.lng)?.label).toBe('2')
  })

  test('a route nothing draws has no curated style', () => {
    setPortolanRouteIndex('mta-subway', { '2': { label: '2' } })
    expect(bulletFor('B62', BROOKLYN.lat, BROOKLYN.lng)).toBe(null)
    expect(bulletFor('', BROOKLYN.lat, BROOKLYN.lng)).toBe(null)
  })

  test('a place outside every pyramid gets nothing, not another city’s', () => {
    setPortolanRouteIndex('mexico', { B_CMX0200L2: { label: '2', shape: 'notch' } })
    expect(bulletFor('B_CMX0200L2', BROOKLYN.lat, BROOKLYN.lng)).toBe(null)
  })

  test('a feed with no index is skipped, not thrown on', () => {
    setPortolanRouteIndex('mta-subway', null)
    setPortolanRouteIndex('northeast-corridor', { 'f3:2': { label: '2', color: 'D82233' } })
    expect(bulletFor('2', BROOKLYN.lat, BROOKLYN.lng)?.color).toBe('D82233')
  })
})

describe('telling two agencies apart by mode', () => {
  /**
   * The reported bug. New York publishes no subway pyramid, so a station
   * header's "4" fell through to northeast-corridor — where `f1:4` is the Long
   * Island Rail Road's Ronkonkoma Branch, and the suffix match took it. Every
   * Lexington Avenue bullet came out a magenta commuter-rail pill, and so did
   * the 5, 6 and 7 as Montauk, Long Beach and Far Rockaway.
   */
  beforeEach(() => {
    resetPortolanBullets([NYC])
    setPortolanRouteIndex('northeast-corridor', {
      'f1:4': { label: 'Ronkonkoma Branch', color: 'A626AA', mode: 'regional' },
      'f1:6': { label: 'Long Beach Branch', color: 'FF6319', mode: 'regional' },
    })
  })

  test('refuses a commuter-rail bullet for a subway route', () => {
    expect(bulletFor('4', BROOKLYN.lat, BROOKLYN.lng, 1)).toBeNull()
    expect(bulletFor('6', BROOKLYN.lat, BROOKLYN.lng, 1)).toBeNull()
  })

  test('still takes it for a route of that mode', () => {
    expect(bulletFor('4', BROOKLYN.lat, BROOKLYN.lng, 2)?.label).toBe('Ronkonkoma Branch')
    // 109 is an extended rail type, and portolan files it as regional too.
    expect(bulletFor('6', BROOKLYN.lat, BROOKLYN.lng, 109)?.label).toBe('Long Beach Branch')
  })

  test('matches as loosely as before when no mode is given', () => {
    expect(bulletFor('4', BROOKLYN.lat, BROOKLYN.lng)?.label).toBe('Ronkonkoma Branch')
  })

  test('takes a bullet that never declared a mode', () => {
    // An older pyramid predates the mode field; it cannot contradict anything.
    setPortolanRouteIndex('northeast-corridor', { '4': { label: '4', color: '00933C' } })
    expect(bulletFor('4', BROOKLYN.lat, BROOKLYN.lng, 1)?.label).toBe('4')
  })
})

describe('a trip’s lines', () => {
  const CHARLOTTE = { feed: 'charlotte-region', maxzoom: 18, bounds: [-81, 35, -80.6, 35.4] }
  const UPTOWN = { lat: 35.22, lng: -80.84 }

  const ride = (overrides: Record<string, unknown> = {}) => ({
    mode: 'transit',
    routeType: 'tram',
    lineName: '501',
    lineColor: null as string | null,
    lineTextColor: null as string | null,
    departureStop: { location: UPTOWN },
    transitDetails: { route: { id: 'cats_501' } },
    routeOptions: undefined as { id: string; shortName: string; color?: string }[] | undefined,
    ...overrides,
  })

  beforeEach(() => {
    resetPortolanBullets([CHARLOTTE])
    setPortolanRouteIndex('charlotte-region', {
      '501': { label: 'Blue', color: '0067B1', mode: 'tram' },
      '510': { label: 'Gold', color: 'CBA052', mode: 'tram' },
    })
  })

  test('take the curated colour over the feed’s, and keep the feed’s name', () => {
    const [seg] = withCuratedLineColors({ segments: [ride({ lineColor: '00933C', lineTextColor: 'FFFFFF' })] }).segments
    expect(seg).toMatchObject({ lineName: '501', lineColor: '0067B1', lineTextColor: null })
  })

  test('colour each interchangeable route on its own', () => {
    const [seg] = withCuratedLineColors({
      segments: [ride({
        routeOptions: [
          { id: 'cats_501', shortName: '501' },
          { id: 'cats_510', shortName: '510' },
          { id: 'cats_7', shortName: '7', color: '123456' },
        ],
      })],
    }).segments
    expect(seg.routeOptions?.map(o => o.color)).toEqual(['0067B1', 'CBA052', '123456'])
  })

  test('match only the curated mode the planner names', () => {
    const [seg] = withCuratedLineColors({ segments: [ride({ routeType: 'bus' })] }).segments
    expect(seg.lineColor).toBeNull()
  })

  test('leave walks and uncurated lines alone', () => {
    const walk = { mode: 'walking' }
    const bus = ride({ lineName: '7', lineColor: '123456', transitDetails: { route: { id: 'cats_7' } } })
    const { segments } = withCuratedLineColors({ segments: [walk, bus] })
    expect(segments[0]).toBe(walk)
    expect(segments[1]).toMatchObject({ lineColor: '123456' })
  })
})
