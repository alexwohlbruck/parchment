/**
 * Unit tests for place deduplication and merging.
 *
 * This is the conflation layer that decides whether two results from different
 * providers are the same real-world place. Both failure modes are user-visible:
 * merging too eagerly collapses genuinely distinct neighbours into one pin,
 * while merging too little shows the same cafe three times.
 *
 * The rules encoded here and asserted below:
 *   - an intersection never merges with a non-intersection, even when
 *     co-located (a tram stop named "Hawthorne & 8th" sits right on the road
 *     intersection of the same name);
 *   - beyond 500m nothing merges, regardless of how well the names match;
 *   - the name-similarity bar RISES with distance — two "Starbucks" 400m apart
 *     need a much better match than two at the same coordinate;
 *   - when both places carry addresses and sit close together, a conflicting
 *     address blocks the merge outright.
 *
 * These are pure functions, so no mocking is involved.
 */

import { describe, test, expect } from 'bun:test'
import {
  getSourcePriority,
  extractCommonsFilename,
  normalizeText,
  calculateTextSimilarity,
  extractNumbers,
  calculateAddressSimilarity,
  getAddressString,
  createTurfPoint,
  mergePlacesCollection,
} from './merge.service'
import { SOURCE } from '../lib/constants'

/**
 * Place fixture. `mergePlaces` dereferences `externalIds`, `contactInfo` and
 * `ratings` without guarding, so those containers are always present here even
 * though the merge *decision* logic only reads name, geometry and address.
 */
function place(over: Partial<any> = {}): any {
  const { lat = 35.2, lng = -80.8, name = 'Cafe', ...rest } = over
  return {
    id: 'p1',
    name: { value: name, source: SOURCE.OSM },
    geometry: { value: { center: { lat, lng } }, source: SOURCE.OSM },
    sources: [{ id: SOURCE.OSM }],
    externalIds: {},
    contactInfo: {},
    ratings: {},
    tags: {},
    photos: [],
    reviews: [],
    ...rest,
  }
}

/** Build a structured address wrapper. */
function address(street1: string, over: Partial<any> = {}) {
  return { value: { street1, ...over }, source: SOURCE.OSM }
}

describe('getSourcePriority', () => {
  test('ranks OSM above Overpass', () => {
    expect(getSourcePriority(SOURCE.OSM)).toBeGreaterThan(
      getSourcePriority(SOURCE.OVERPASS),
    )
  })

  test('returns 0 for an unknown source', () => {
    expect(getSourcePriority('made-up-source')).toBe(0)
  })
})

describe('extractCommonsFilename', () => {
  test('parses a direct upload URL', () => {
    expect(
      extractCommonsFilename(
        'https://upload.wikimedia.org/wikipedia/commons/e/ec/EastWest_Blvd.jpg',
      ),
    ).toBe('EastWest_Blvd.jpg')
  })

  test('parses a Special:FilePath URL', () => {
    expect(
      extractCommonsFilename(
        'https://commons.wikimedia.org/wiki/Special:FilePath/EastWest%20Blvd.jpg',
      ),
    ).toBe('EastWest_Blvd.jpg')
  })

  test('parses a File: page URL', () => {
    expect(
      extractCommonsFilename(
        'https://commons.wikimedia.org/wiki/File:EastWest_Blvd.jpg',
      ),
    ).toBe('EastWest_Blvd.jpg')
  })

  test('normalizes spaces to underscores so the forms compare equal', () => {
    const fromPath = extractCommonsFilename(
      'https://commons.wikimedia.org/wiki/Special:FilePath/EastWest%20Blvd.jpg',
    )
    const fromPage = extractCommonsFilename(
      'https://commons.wikimedia.org/wiki/File:EastWest_Blvd.jpg',
    )

    expect(fromPath).toBe(fromPage!)
  })

  test('returns null for a non-Commons URL', () => {
    expect(extractCommonsFilename('https://example.com/photo.jpg')).toBeNull()
  })

  test('returns null rather than throwing on junk input', () => {
    expect(extractCommonsFilename('not a url at all')).toBeNull()
  })
})

describe('normalizeText', () => {
  test('lowercases and trims', () => {
    expect(normalizeText('  Joe’s CAFE  ')).toBe('joe s cafe')
  })

  test('strips common business suffixes', () => {
    expect(normalizeText('Acme Inc')).toBe('acme')
    expect(normalizeText('Acme Corporation')).toBe('acme')
    expect(normalizeText('Acme LLC')).toBe('acme')
  })

  test('collapses punctuation into single spaces', () => {
    expect(normalizeText('Joe & Sons, Ltd.')).toBe('joe sons')
  })

  test('keeps accented letters intact', () => {
    // Global data — stripping diacritics would break non-English names.
    expect(normalizeText('Café Münster')).toBe('café münster')
  })

  test('handles an already-normal string unchanged', () => {
    expect(normalizeText('starbucks')).toBe('starbucks')
  })
})

describe('calculateTextSimilarity', () => {
  test('scores identical names as a perfect match', () => {
    expect(calculateTextSimilarity('Starbucks', 'Starbucks')).toBe(1)
  })

  test('ignores case', () => {
    expect(calculateTextSimilarity('STARBUCKS', 'starbucks')).toBe(1)
  })

  test('scores punctuation differences as a near match', () => {
    // The apostrophe normalizes to a space, splitting "Joe’s" into two tokens,
    // so this lands just under a perfect score rather than at 1.
    expect(
      calculateTextSimilarity('Joe’s Pizza', 'joes pizza'),
    ).toBeGreaterThan(0.8)
  })

  test('treats a business suffix as noise', () => {
    expect(calculateTextSimilarity('Acme Inc', 'Acme')).toBe(1)
  })

  test('scores unrelated names low', () => {
    expect(calculateTextSimilarity('Starbucks', 'Home Depot')).toBeLessThan(0.5)
  })

  test('returns 0 when either side is empty', () => {
    expect(calculateTextSimilarity('', 'Starbucks')).toBe(0)
    expect(calculateTextSimilarity('Starbucks', '')).toBe(0)
  })
})

describe('extractNumbers', () => {
  test('pulls house numbers out of a street string', () => {
    expect(extractNumbers('123 Main St')).toEqual(['123'])
  })

  test('keeps a letter suffix', () => {
    expect(extractNumbers('123a Main St')).toEqual(['123a'])
  })

  test('returns an empty list when there are none', () => {
    expect(extractNumbers('Main Street')).toEqual([])
  })
})

describe('calculateAddressSimilarity', () => {
  test('returns 0 when either place has no address', () => {
    expect(
      calculateAddressSimilarity(place(), place({ address: address('123 Main St') })),
    ).toBe(0)
  })

  test('matches identical structured addresses', () => {
    const a = place({ address: address('123 Main St') })
    const b = place({ address: address('123 Main St') })

    expect(calculateAddressSimilarity(a, b)).toBe(1)
  })

  test('resolves street-type abbreviations', () => {
    const a = place({ address: address('123 Main St') })
    const b = place({ address: address('123 Main Street') })

    expect(calculateAddressSimilarity(a, b)).toBe(1)
  })

  test('resolves directional abbreviations', () => {
    const a = place({ address: address('123 N Main St') })
    const b = place({ address: address('123 North Main Street') })

    expect(calculateAddressSimilarity(a, b)).toBe(1)
  })

  test('rejects outright when house numbers conflict', () => {
    // Same street, different building — not the same place.
    const a = place({ address: address('123 Main St') })
    const b = place({ address: address('456 Main St') })

    expect(calculateAddressSimilarity(a, b)).toBe(0)
  })

  test('falls back to the first segment of a formatted address', () => {
    const a = place({
      address: { value: { formatted: '123 Main St, Charlotte, NC' }, source: SOURCE.OSM },
    })
    const b = place({ address: address('123 Main St') })

    expect(calculateAddressSimilarity(a, b)).toBe(1)
  })

  test('returns 0 when no street can be extracted', () => {
    const a = place({ address: { value: { locality: 'Charlotte' }, source: SOURCE.OSM } })
    const b = place({ address: address('123 Main St') })

    expect(calculateAddressSimilarity(a, b)).toBe(0)
  })
})

describe('getAddressString', () => {
  test('prefers the formatted address', () => {
    expect(
      getAddressString(
        place({
          address: {
            value: { formatted: '123 Main St, Charlotte', street1: '123 Main St' },
            source: SOURCE.OSM,
          },
        }),
      ),
    ).toBe('123 Main St, Charlotte')
  })

  test('joins street and locality when unformatted', () => {
    expect(
      getAddressString(
        place({ address: address('123 Main St', { locality: 'Charlotte' }) }),
      ),
    ).toBe('123 Main St Charlotte')
  })

  test('returns null with no address at all', () => {
    expect(getAddressString(place())).toBeNull()
  })
})

describe('createTurfPoint', () => {
  test('emits GeoJSON lng/lat order', () => {
    const point = createTurfPoint(place({ lat: 35.2, lng: -80.8 }))

    expect(point.geometry.coordinates).toEqual([-80.8, 35.2])
  })
})

describe('mergePlacesCollection — merge decisions', () => {
  test('returns a single place untouched', () => {
    const only = [place()]

    expect(mergePlacesCollection(only)).toBe(only)
  })

  test('merges two identical co-located places', () => {
    const merged = mergePlacesCollection([
      place({ id: 'a', name: 'Starbucks' }),
      place({ id: 'b', name: 'Starbucks', sources: [{ id: SOURCE.GOOGLE }] }),
    ])

    expect(merged).toHaveLength(1)
  })

  test('keeps clearly different places apart', () => {
    const merged = mergePlacesCollection([
      place({ id: 'a', name: 'Starbucks' }),
      place({ id: 'b', name: 'Home Depot' }),
    ])

    expect(merged).toHaveLength(2)
  })

  test('never merges an intersection with a non-intersection', () => {
    // A tram stop named after the crossing sits right on top of it.
    const merged = mergePlacesCollection([
      place({
        id: 'stop',
        name: 'Hawthorne & 8th',
        placeType: { value: 'TransitStop' },
      }),
      place({
        id: 'crossing',
        name: 'Hawthorne & 8th',
        placeType: { value: 'Intersection' },
      }),
    ])

    expect(merged).toHaveLength(2)
  })

  test('merges two intersections with the same name', () => {
    const merged = mergePlacesCollection([
      place({ id: 'a', name: 'Hawthorne & 8th', placeType: { value: 'Intersection' } }),
      place({ id: 'b', name: 'Hawthorne & 8th', placeType: { value: 'Intersection' } }),
    ])

    expect(merged).toHaveLength(1)
  })

  test('never merges beyond the 500m cutoff', () => {
    // ~1.1km apart at this latitude.
    const merged = mergePlacesCollection([
      place({ id: 'a', name: 'Starbucks', lat: 35.2, lng: -80.8 }),
      place({ id: 'b', name: 'Starbucks', lat: 35.21, lng: -80.8 }),
    ])

    expect(merged).toHaveLength(2)
  })

  test('the name bar rises with distance', () => {
    // "Cafe Bar" vs "Cafe Bistro" merges when co-located...
    const together = mergePlacesCollection([
      place({ id: 'a', name: 'Cafe Bar', lat: 35.2, lng: -80.8 }),
      place({ id: 'b', name: 'Cafe Bar Bistro', lat: 35.2, lng: -80.8 }),
    ])
    expect(together).toHaveLength(1)

    // ...but the same pair ~330m apart no longer clears the higher bar.
    const apart = mergePlacesCollection([
      place({ id: 'a', name: 'Cafe Bar', lat: 35.2, lng: -80.8 }),
      place({ id: 'b', name: 'Cafe Bar Bistro', lat: 35.203, lng: -80.8 }),
    ])
    expect(apart).toHaveLength(2)
  })

  test('a partially-matching address blocks a merge between close places', () => {
    // Similar-but-not-equal streets score between 0 and 0.7, which is what the
    // guard in shouldMergePlaces actually looks for.
    const merged = mergePlacesCollection([
      place({ id: 'a', name: 'Starbucks', address: address('Main St') }),
      place({ id: 'b', name: 'Starbucks', address: address('Juniper Hollow Way') }),
    ])

    expect(merged).toHaveLength(2)
  })

  test('BUG: a directly conflicting house number does NOT block a merge', () => {
    // calculateAddressSimilarity returns 0 both for "no address data" and for
    // "house numbers conflict". shouldMergePlaces only blocks when the score is
    // strictly between 0 and 0.7, so a definite conflict falls through to the
    // no-address scoring branch (name 70% + distance 30%) and merges.
    //
    // Result: 123 Main St and 456 Main St, same name, ~22m apart, collapse into
    // one pin. Asserted as-is so a fix flips this test. See the accompanying
    // issue.
    const merged = mergePlacesCollection([
      place({ id: 'a', name: 'Starbucks', address: address('123 Main St') }),
      place({
        id: 'b',
        name: 'Starbucks',
        address: address('456 Main St'),
        lat: 35.2002,
      }),
    ])

    expect(merged).toHaveLength(1)
  })

  test('a matching address confirms a merge', () => {
    const merged = mergePlacesCollection([
      place({ id: 'a', name: 'Starbucks', address: address('123 Main St') }),
      place({
        id: 'b',
        name: 'Starbucks',
        address: address('123 Main Street'),
        sources: [{ id: SOURCE.GOOGLE }],
      }),
    ])

    expect(merged).toHaveLength(1)
  })

  test('groups three duplicates into one', () => {
    const merged = mergePlacesCollection([
      place({ id: 'a', name: 'Starbucks' }),
      place({ id: 'b', name: 'Starbucks', sources: [{ id: SOURCE.GOOGLE }] }),
      place({ id: 'c', name: 'Starbucks', sources: [{ id: SOURCE.FOURSQUARE }] }),
    ])

    expect(merged).toHaveLength(1)
  })

  test('handles an empty input', () => {
    expect(mergePlacesCollection([])).toEqual([])
  })
})

describe('mergePlacesCollection — primary selection', () => {
  test('the highest-priority source wins the merged identity', () => {
    // Overpass (50) loses to OSM (100).
    const merged = mergePlacesCollection([
      place({ id: 'overpass', name: 'Starbucks', sources: [{ id: SOURCE.OVERPASS }] }),
      place({ id: 'osm', name: 'Starbucks', sources: [{ id: SOURCE.OSM }] }),
    ])

    expect(merged).toHaveLength(1)
    expect(merged[0].id).toBe('osm')
  })

  test('order in the input does not decide the winner', () => {
    const forward = mergePlacesCollection([
      place({ id: 'osm', name: 'Starbucks', sources: [{ id: SOURCE.OSM }] }),
      place({ id: 'overpass', name: 'Starbucks', sources: [{ id: SOURCE.OVERPASS }] }),
    ])

    expect(forward[0].id).toBe('osm')
  })

  test('a place with an unknown source still merges', () => {
    const merged = mergePlacesCollection([
      place({ id: 'osm', name: 'Starbucks', sources: [{ id: SOURCE.OSM }] }),
      place({ id: 'weird', name: 'Starbucks', sources: [] }),
    ])

    expect(merged).toHaveLength(1)
    expect(merged[0].id).toBe('osm')
  })
})
