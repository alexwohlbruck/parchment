import { describe, expect, test } from 'vitest'
import {
  collectStopCandidates,
  type TransitStopFeatureLike,
} from './transit-stop-candidates'

/**
 * Candidate dedupe / disambiguation logic for the transit stop click-through:
 * queryRenderedFeatures over the transit stop layers returns overlapping and
 * tile-duplicated `transit_stops` point features, which must collapse to one
 * candidate per (feedId, stopId) in a deterministic order.
 */

/** `transit_stops` point feature as reported by queryRenderedFeatures. */
function stopFeature(
  overrides: Record<string, unknown> = {},
  coordinates: [number, number] | null = [-87.6305, 41.8845],
): TransitStopFeatureLike {
  return {
    properties: {
      feed_id: '29',
      stop_id: '1001',
      stop_name: 'State & Lake',
      location_type: 0,
      is_rail: false,
      route_count: 3,
      route_color: '',
      ...overrides,
    },
    geometry: coordinates
      ? { type: 'Point', coordinates }
      : { type: 'Point' },
  }
}

describe('collectStopCandidates', () => {
  test('single feature yields one candidate with all fields', () => {
    const candidates = collectStopCandidates([
      stopFeature({ route_color: '62361B' }),
    ])
    expect(candidates).toEqual([
      {
        feedId: '29',
        stopId: '1001',
        name: 'State & Lake',
        lngLat: { lng: -87.6305, lat: 41.8845 },
        isRail: false,
        routeColor: '62361B',
        routeCount: 3,
      },
    ])
  })

  test('duplicate (feedId, stopId) hits collapse to one candidate', () => {
    const candidates = collectStopCandidates([
      stopFeature(),
      stopFeature(),
      stopFeature(),
    ])
    expect(candidates).toHaveLength(1)
  })

  test('duplicate hits enrich missing fields', () => {
    const candidates = collectStopCandidates([
      stopFeature({ stop_name: '', route_color: '' }, null),
      stopFeature({ route_color: 'C60C30' }),
    ])
    expect(candidates).toHaveLength(1)
    expect(candidates[0].name).toBe('State & Lake')
    expect(candidates[0].routeColor).toBe('C60C30')
    expect(candidates[0].lngLat).toEqual({ lng: -87.6305, lat: 41.8845 })
  })

  test('features without feed_id or stop_id are skipped', () => {
    const candidates = collectStopCandidates([
      stopFeature({ feed_id: '' }),
      stopFeature({ stop_id: '' }),
      { properties: null },
      {},
    ])
    expect(candidates).toEqual([])
  })

  test('numeric ids are stringified', () => {
    const candidates = collectStopCandidates([
      stopFeature({ feed_id: 29, stop_id: 30374 }),
    ])
    expect(candidates[0].feedId).toBe('29')
    expect(candidates[0].stopId).toBe('30374')
  })

  test('rail stops sort before bus stops, then natural name order', () => {
    const candidates = collectStopCandidates([
      stopFeature({ stop_id: 'b2', stop_name: 'Stop 10' }),
      stopFeature({ stop_id: 'r1', stop_name: 'Zeta', is_rail: true }),
      stopFeature({ stop_id: 'b1', stop_name: 'Stop 2' }),
    ])
    expect(candidates.map(c => c.stopId)).toEqual(['r1', 'b1', 'b2'])
  })

  test('is_rail survives string-encoded tile properties', () => {
    const candidates = collectStopCandidates([
      stopFeature({ is_rail: 'true' }),
    ])
    expect(candidates[0].isRail).toBe(true)
  })

  test('unnamed stops fall back to stop id ordering', () => {
    const candidates = collectStopCandidates([
      stopFeature({ stop_id: '10', stop_name: '' }),
      stopFeature({ stop_id: '2', stop_name: '' }),
    ])
    expect(candidates.map(c => c.stopId)).toEqual(['2', '10'])
  })

  test('non-point geometry yields null lngLat', () => {
    const candidates = collectStopCandidates([
      {
        properties: { feed_id: '29', stop_id: '1' },
        geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
      },
    ])
    expect(candidates[0].lngLat).toBeNull()
  })
})
