import { describe, expect, test } from 'vitest'
import {
  collectRouteCandidates,
  type TransitFeatureLike,
} from './transit-route-candidates'

/**
 * Candidate dedupe / disambiguation logic for the transit line click-through:
 * queryRenderedFeatures over the transit route layers returns overlapping
 * features (casing + colour pass + hover hitbox; bundled ribbons with
 * comma-separated route_ids), which must collapse to one candidate per
 * (feedId, routeId) in a deterministic order.
 */

/** Non-bundled `transit_routes` feature (one route per feature). */
function routeFeature(
  overrides: Record<string, unknown> = {},
): TransitFeatureLike {
  return {
    properties: {
      feed_id: '29',
      route_id: 'Red',
      route_short_name: 'Red',
      route_long_name: 'Red Line',
      route_color: 'C60C30',
      route_text_color: 'FFFFFF',
      route_type: 1,
      ...overrides,
    },
  }
}

/** Bundled `transit_lines_rt2` ribbon feature (comma-separated route lists). */
function ribbonFeature(
  overrides: Record<string, unknown> = {},
): TransitFeatureLike {
  return {
    properties: {
      kind: 'steady',
      feed_id: '29',
      route_ids: 'Brn',
      route_short_names: 'Brn',
      route_color: '62361B',
      route_text_color: 'FFFFFF',
      route_type: 1,
      slot: 0,
      line_count: 5,
      ...overrides,
    },
  }
}

describe('collectRouteCandidates', () => {
  test('single non-bundled feature yields one candidate with all fields', () => {
    const candidates = collectRouteCandidates([routeFeature()])
    expect(candidates).toEqual([
      {
        feedId: '29',
        routeId: 'Red',
        shortName: 'Red',
        longName: 'Red Line',
        color: 'C60C30',
        textColor: 'FFFFFF',
        routeType: 1,
      },
    ])
  })

  test('bundled ribbon with comma-separated route_ids yields one candidate per id', () => {
    const candidates = collectRouteCandidates([
      ribbonFeature({ route_ids: 'A,B', route_short_names: 'A,B' }),
    ])
    expect(candidates.map(c => c.routeId)).toEqual(['A', 'B'])
    expect(candidates.map(c => c.shortName)).toEqual(['A', 'B'])
    // Ribbon-level styling is shared across the interlined routes.
    for (const candidate of candidates) {
      expect(candidate.feedId).toBe('29')
      expect(candidate.color).toBe('62361B')
      expect(candidate.longName).toBeNull()
    }
  })

  test('dedupes the same route hit through several layers', () => {
    const candidates = collectRouteCandidates([
      routeFeature(), // colour pass
      routeFeature(), // casing
      routeFeature({ route_long_name: '' }), // hover hitbox, sparser props
    ])
    expect(candidates).toHaveLength(1)
  })

  test('dedupes across bundled and non-bundled features, keeping richer fields', () => {
    const candidates = collectRouteCandidates([
      ribbonFeature({ route_ids: 'Red', route_short_names: 'Red' }),
      routeFeature(), // same route via transit_routes, carries the long name
    ])
    expect(candidates).toHaveLength(1)
    expect(candidates[0].longName).toBe('Red Line') // merged in
    expect(candidates[0].color).toBe('62361B') // first hit wins existing fields
  })

  test('same route id in different feeds stays distinct', () => {
    const candidates = collectRouteCandidates([
      routeFeature({ feed_id: '29' }),
      routeFeature({ feed_id: '87' }),
    ])
    expect(candidates).toHaveLength(2)
  })

  test('skips features without feed or route identity', () => {
    const candidates = collectRouteCandidates([
      { properties: { feed_id: '29' } }, // no route_id(s)
      { properties: { route_id: 'Red' } }, // no feed_id
      { properties: null },
      {},
      routeFeature(),
    ])
    expect(candidates).toHaveLength(1)
  })

  test('mismatched route_short_names list falls back to the route id', () => {
    const candidates = collectRouteCandidates([
      ribbonFeature({ route_ids: 'A,B,C', route_short_names: 'A,B' }),
    ])
    expect(candidates.map(c => c.shortName)).toEqual(['A', 'B', 'C'])
  })

  test('empty-string colours become null (type fallback happens in the UI)', () => {
    const candidates = collectRouteCandidates([
      routeFeature({ route_color: '', route_text_color: '' }),
    ])
    expect(candidates[0].color).toBeNull()
    expect(candidates[0].textColor).toBeNull()
  })

  test('orders by route_type then natural short-name order', () => {
    const candidates = collectRouteCandidates([
      routeFeature({ route_id: '10', route_short_name: '10', route_type: 3 }),
      routeFeature({ route_id: '2', route_short_name: '2', route_type: 3 }),
      routeFeature({ route_id: 'Blue', route_short_name: 'Blue', route_type: 1 }),
      routeFeature({ route_id: 'nt', route_short_name: null, route_type: null }),
    ])
    expect(candidates.map(c => c.routeId)).toEqual(['Blue', '2', '10', 'nt'])
  })

  test('numeric tile properties are tolerated (gzip/JSON round-trips vary)', () => {
    const candidates = collectRouteCandidates([
      routeFeature({ feed_id: 29, route_id: 66, route_short_name: 66 }),
    ])
    expect(candidates).toEqual([
      expect.objectContaining({ feedId: '29', routeId: '66', shortName: '66' }),
    ])
  })

  test('empty input yields no candidates', () => {
    expect(collectRouteCandidates([])).toEqual([])
  })
})
