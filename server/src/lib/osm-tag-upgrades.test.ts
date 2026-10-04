import { describe, test, expect } from 'bun:test'
import { initializeOsmPresets } from './osm-presets'
import { suggestTagUpgrades } from './osm-tag-upgrades'

initializeOsmPresets()

describe('suggestTagUpgrades', () => {
  test('replaces a deprecated tag', () => {
    const { changes } = suggestTagUpgrades({ amenity: 'cafe', access: 'customer' })
    expect(changes).toContainEqual({ key: 'access', from: 'customer', to: 'customers' })
  })

  test('carries a wildcard value into its replacement', () => {
    const { changes } = suggestTagUpgrades({ tourism: 'artwork', artwork: 'statue' })
    expect(changes).toContainEqual({ key: 'artwork', from: 'statue', to: null })
    expect(changes).toContainEqual({ key: 'artwork_type', from: null, to: 'statue' })
  })

  test("applies a chain's tags and keeps the branch's own name", () => {
    const { changes, brand } = suggestTagUpgrades({
      amenity: 'fast_food',
      name: 'taco bell',
    })
    expect(brand?.wikidata).toBe('Q752941')
    expect(changes).toContainEqual({ key: 'brand:wikidata', from: null, to: 'Q752941' })
    expect(changes.some((c) => c.key === 'name')).toBe(false)
  })

  test('respects a declined chain', () => {
    const { brand } = suggestTagUpgrades({
      amenity: 'fast_food',
      name: 'taco bell',
      'not:brand:wikidata': 'Q752941',
    })
    expect(brand).toBeNull()
  })

  test('suggests nothing for up-to-date tags', () => {
    expect(suggestTagUpgrades({ amenity: 'bench' }).changes).toEqual([])
  })
})
