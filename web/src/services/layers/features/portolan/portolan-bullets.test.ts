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
