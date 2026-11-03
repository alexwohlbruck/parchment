import { describe, expect, test } from 'vitest'
import { featureFilter, validateStyleMin } from '@maplibre/maplibre-gl-style-spec'
import { combineFilters } from './combine-filters'

const NEVER = ['literal', false]
const legacy = ['all', ['==', 'class', 'city'], ['!=', 'capital', 2]]
const expression = ['==', ['get', 'class'], 'city']

function errors(filter: unknown) {
  return validateStyleMin({
    version: 8,
    sources: { s: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
    layers: [{ id: 'l', type: 'symbol', source: 's', filter }],
  } as any)
}

function matches(filter: unknown, properties: Record<string, unknown>) {
  const feature = { type: 1, properties, geometry: [] } as any
  return featureFilter(filter as any, 'layers[0].filter').filter({ zoom: 10 }, feature)
}

describe('combineFilters', () => {
  test.each([
    ['legacy', legacy],
    ['expression', expression],
  ])('a %s base filter combines into a valid filter', (_, base) => {
    const filter = combineFilters([base, NEVER])
    expect(errors(filter)).toEqual([])
    expect(matches(filter, { class: 'city', capital: 1 })).toBe(false)
  })

  test('a converted legacy filter still selects what the original did', () => {
    const filter = combineFilters([legacy])
    expect(matches(filter, { class: 'city', capital: 1 })).toBe(true)
    expect(matches(filter, { class: 'city', capital: 2 })).toBe(false)
  })

  test('no clauses clears the filter', () => {
    expect(combineFilters([null, false, 0])).toBeNull()
  })
})
