/**
 * Unit tests for the Geoapify category mapping.
 *
 * The OSM→Geoapify direction is derived by inverting the hand-written
 * Geoapify→OSM table at module load. That inversion is only lossless while
 * every preset id appears exactly once: a duplicate would silently make one of
 * the two categories unreachable from the preset side, so category search for
 * that preset would quietly return results for the wrong thing. The
 * uniqueness invariant is asserted directly rather than left implicit.
 */

import { describe, test, expect } from 'bun:test'
import {
  GEOAPIFY_TO_OSM_MAPPING,
  getGeoapifyCategory,
  getPresetFromGeoapifyCategory,
  getSupportedGeoapifyPresets,
  getSupportedGeoapifyCategories,
  isGeoapifyPresetSupported,
  isGeoapifyCategorySupported,
} from './geoapify-preset-mapping'

describe('table invariants', () => {
  test('every preset id maps from exactly one category', () => {
    // The reverse map is built by inversion; duplicates would drop entries.
    const presets = Object.values(GEOAPIFY_TO_OSM_MAPPING)

    expect(new Set(presets).size).toBe(presets.length)
  })

  test('categories use the dotted hierarchy or a bare top level', () => {
    for (const category of Object.keys(GEOAPIFY_TO_OSM_MAPPING)) {
      expect(category).toMatch(/^[a-z0-9_]+(\.[a-z0-9_]+)*$/)
    }
  })

  test('preset ids use the OSM key/value form or a bare key', () => {
    for (const preset of Object.values(GEOAPIFY_TO_OSM_MAPPING)) {
      expect(preset).toMatch(/^[a-z0-9_]+(\/[a-z0-9_:]+)*$/)
    }
  })

  test('the table is not empty', () => {
    expect(Object.keys(GEOAPIFY_TO_OSM_MAPPING).length).toBeGreaterThan(100)
  })
})

describe('getGeoapifyCategory', () => {
  test('resolves a known preset', () => {
    expect(getGeoapifyCategory('tourism/hotel')).toBe('accommodation.hotel')
  })

  test('returns null for an unmapped preset', () => {
    expect(getGeoapifyCategory('amenity/does_not_exist')).toBeNull()
  })

  test('returns null for an empty id', () => {
    expect(getGeoapifyCategory('')).toBeNull()
  })

  test('does not resolve inherited Object properties', () => {
    // A bare `[]`/`in` lookup would answer for prototype members, handing back
    // a function where the signature promises `string | null`. Reachable
    // whenever a preset id arrives from a request.
    expect(getGeoapifyCategory('constructor')).toBeNull()
    expect(getGeoapifyCategory('toString')).toBeNull()
    expect(getGeoapifyCategory('__proto__')).toBeNull()
    expect(isGeoapifyPresetSupported('constructor')).toBe(false)
  })

  test('does not resolve inherited properties in the category direction either', () => {
    expect(getPresetFromGeoapifyCategory('constructor')).toBeNull()
    expect(isGeoapifyCategorySupported('valueOf')).toBe(false)
  })
})

describe('getPresetFromGeoapifyCategory', () => {
  test('resolves a known category', () => {
    expect(getPresetFromGeoapifyCategory('accommodation.hotel')).toBe(
      'tourism/hotel',
    )
  })

  test('returns null for an unmapped category', () => {
    expect(getPresetFromGeoapifyCategory('nonsense.category')).toBeNull()
  })

  test('round-trips every entry in both directions', () => {
    for (const [category, preset] of Object.entries(GEOAPIFY_TO_OSM_MAPPING)) {
      expect(getGeoapifyCategory(preset)).toBe(category)
      expect(getPresetFromGeoapifyCategory(category)).toBe(preset)
    }
  })
})

describe('support checks', () => {
  test('report membership for both directions', () => {
    expect(isGeoapifyPresetSupported('tourism/hotel')).toBe(true)
    expect(isGeoapifyPresetSupported('amenity/does_not_exist')).toBe(false)
    expect(isGeoapifyCategorySupported('accommodation.hotel')).toBe(true)
    expect(isGeoapifyCategorySupported('nonsense.category')).toBe(false)
  })

  test('agree with the lookup functions', () => {
    for (const preset of getSupportedGeoapifyPresets()) {
      expect(isGeoapifyPresetSupported(preset)).toBe(true)
      expect(getGeoapifyCategory(preset)).not.toBeNull()
    }
  })
})

describe('supported lists', () => {
  test('expose the same entries as the table', () => {
    expect(getSupportedGeoapifyCategories()).toEqual(
      Object.keys(GEOAPIFY_TO_OSM_MAPPING),
    )
    expect(getSupportedGeoapifyPresets()).toEqual(
      Object.values(GEOAPIFY_TO_OSM_MAPPING),
    )
  })

  test('are the same length as each other', () => {
    expect(getSupportedGeoapifyPresets()).toHaveLength(
      getSupportedGeoapifyCategories().length,
    )
  })
})
