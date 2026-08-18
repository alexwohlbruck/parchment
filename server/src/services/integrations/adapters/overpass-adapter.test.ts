/**
 * Unit tests for the Overpass (raw OSM) adapter.
 *
 * OSM tagging is famously inconsistent, so this adapter is mostly a pile of
 * fallback chains — `name` → `name:en` → `brand` → `operator` → `ref`, and the
 * `contact:*` prefix mirroring every contact tag. Those orderings are the
 * contract: reordering them changes which label a place shows.
 *
 * The geometry hint matters too. Ways and relations are matched as `area`
 * rather than `point`, so a building outline resolves to the building preset
 * instead of the point-only fallback — that decides which icon renders.
 */

import { describe, test, expect } from 'bun:test'
import { OverpassAdapter } from './overpass-adapter'
import { SOURCE } from '../../../lib/constants'

const adapter = new OverpassAdapter()

function element(over: Partial<any> = {}): any {
  return {
    type: 'node',
    id: 123456,
    lat: 35.2,
    lon: -80.8,
    tags: {},
    ...over,
  }
}

const adapt = (e: any, id?: string) => adapter.placeInfo.adaptPlaceDetails(e, id)
const withTags = (tags: Record<string, string>) => adapt(element({ tags }))

describe('identity', () => {
  test('builds the id from the OSM type and id', () => {
    const place = adapt(element())

    expect(place.id).toBe(`${SOURCE.OSM}/node/123456`)
    expect(place.externalIds[SOURCE.OSM]).toBe('node/123456')
  })

  test('honours an explicit id override', () => {
    expect(adapt(element(), 'custom/id').id).toBe('custom/id')
  })

  test('links back to the OSM object page', () => {
    const place = adapt(element({ type: 'way', id: 999 }))

    expect(place.sources[0]).toMatchObject({
      id: SOURCE.OSM,
      name: 'OpenStreetMap',
      url: 'https://www.openstreetmap.org/way/999',
    })
  })

  test('carries no photos — OSM has none', () => {
    expect(adapt(element()).photos).toEqual([])
  })
})

describe('name fallback chain', () => {
  test('prefers the plain name tag', () => {
    expect(
      withTags({ name: 'Joe’s Cafe', brand: 'Chain', operator: 'Op' }).name.value,
    ).toBe('Joe’s Cafe')
  })

  test('falls back to name:en', () => {
    expect(withTags({ 'name:en': 'English Name' }).name.value).toBe(
      'English Name',
    )
  })

  test('falls back to brand, then operator, then ref', () => {
    expect(withTags({ brand: 'Starbucks' }).name.value).toBe('Starbucks')
    expect(withTags({ operator: 'City Council' }).name.value).toBe(
      'City Council',
    )
    expect(withTags({ ref: 'A1' }).name.value).toBe('A1')
  })

  test('is null for an untagged element', () => {
    expect(adapt(element({ tags: undefined })).name.value).toBeNull()
  })
})

describe('description fallback chain', () => {
  test('prefers the description tag', () => {
    expect(withTags({ description: 'A cafe', note: 'ignored' })!.description!.value).toBe(
      'A cafe',
    )
  })

  test('falls back through description:en, note and comment', () => {
    expect(withTags({ 'description:en': 'English' })!.description!.value).toBe(
      'English',
    )
    expect(withTags({ note: 'A note' })!.description!.value).toBe('A note')
    expect(withTags({ comment: 'A comment' })!.description!.value).toBe(
      'A comment',
    )
  })

  test('is null with no description-ish tag', () => {
    expect(withTags({ amenity: 'cafe' }).description).toBeNull()
  })
})

describe('geometry', () => {
  test('uses the node coordinates', () => {
    expect(adapt(element()).geometry.value).toEqual({
      type: 'point',
      center: { lat: 35.2, lng: -80.8 },
    })
  })

  test('uses the supplied centre for a way', () => {
    const place = adapt(
      element({
        type: 'way',
        lat: undefined,
        lon: undefined,
        center: { lat: 35.5, lon: -80.5 },
      }),
    )

    expect(place.geometry.value.center).toEqual({ lat: 35.5, lng: -80.5 })
  })

  test('falls back to 0,0 when no coordinates can be derived', () => {
    const place = adapt(
      element({ type: 'relation', lat: undefined, lon: undefined }),
    )

    expect(place.geometry.value.center).toEqual({ lat: 0, lng: 0 })
  })
})

describe('address extraction', () => {
  test('is null with no address tags', () => {
    expect(withTags({ amenity: 'cafe' }).address).toBeNull()
  })

  test('joins housenumber and street into street1', () => {
    const place = withTags({
      'addr:housenumber': '123',
      'addr:street': 'Main St',
    })

    expect(place.address!.value.street1).toBe('123 Main St')
  })

  test('uses the street alone without a housenumber', () => {
    expect(withTags({ 'addr:street': 'Main St' }).address!.value.street1).toBe(
      'Main St',
    )
  })

  test('builds a formatted address from the available parts', () => {
    const place = withTags({
      'addr:housenumber': '123',
      'addr:street': 'Main St',
      'addr:city': 'Charlotte',
      'addr:state': 'NC',
      'addr:postcode': '28202',
      'addr:country': 'US',
    })

    expect(place.address!.value.formatted).toBe(
      '123 Main St, Charlotte, NC 28202, US',
    )
  })

  test('falls back through town and village for the locality', () => {
    expect(
      withTags({ 'addr:street': 'Main St', 'addr:town': 'Cornelius' }).address!
        .value.locality,
    ).toBe('Cornelius')
    expect(
      withTags({ 'addr:street': 'Main St', 'addr:village': 'Davidson' }).address!
        .value.locality,
    ).toBe('Davidson')
  })

  test('falls back to county for the region', () => {
    expect(
      withTags({ 'addr:street': 'Main St', 'addr:county': 'Mecklenburg' })
        .address!.value.region,
    ).toBe('Mecklenburg')
  })

  test('uppercases the country code', () => {
    expect(
      withTags({ 'addr:street': 'Main St', 'addr:country': 'us' }).address!.value
        .countryCode,
    ).toBe('US')
  })

  test('a city alone is enough to produce an address', () => {
    expect(withTags({ 'addr:city': 'Charlotte' }).address).not.toBeNull()
  })

  test('a lone housenumber is not enough', () => {
    // Without a street it is not an address anyone can use.
    expect(withTags({ 'addr:housenumber': '123' }).address).toBeNull()
  })
})

describe('contact info', () => {
  test('extracts phone, email and website', () => {
    const place = withTags({
      phone: '+1 704 555 0100',
      email: 'hi@cafe.test',
      website: 'https://cafe.test',
    })

    expect(place.contactInfo.phone!.value).toBe('+1 704 555 0100')
    expect(place.contactInfo.email!.value).toBe('hi@cafe.test')
    expect(place.contactInfo.website!.value).toBe('https://cafe.test')
  })

  test('mirrors the contact: prefixed variants', () => {
    const place = withTags({
      'contact:phone': '+1 704 555 0100',
      'contact:email': 'hi@cafe.test',
      'contact:website': 'https://cafe.test',
    })

    expect(place.contactInfo.phone!.value).toBe('+1 704 555 0100')
    expect(place.contactInfo.email!.value).toBe('hi@cafe.test')
    expect(place.contactInfo.website!.value).toBe('https://cafe.test')
  })

  test('prefers the unprefixed tag when both exist', () => {
    const place = withTags({
      phone: '+1 704 555 0100',
      'contact:phone': '+1 704 555 9999',
    })

    expect(place.contactInfo.phone!.value).toBe('+1 704 555 0100')
  })

  test('accepts url as a website fallback', () => {
    expect(withTags({ url: 'https://cafe.test' }).contactInfo.website!.value).toBe(
      'https://cafe.test',
    )
  })

  test('collects social platforms', () => {
    const place = withTags({
      facebook: 'https://fb.test/cafe',
      'contact:instagram': 'https://ig.test/cafe',
    })

    expect(place.contactInfo.socials.facebook.value).toBe('https://fb.test/cafe')
    expect(place.contactInfo.socials.instagram.value).toBe('https://ig.test/cafe')
  })

  test('reports empty contact info for an untagged element', () => {
    expect(adapt(element({ tags: undefined })).contactInfo).toMatchObject({
      phone: null,
      email: null,
      website: null,
      socials: {},
    })
  })
})

describe('opening hours', () => {
  test('is null without an opening_hours tag', () => {
    expect(withTags({ amenity: 'cafe' }).openingHours).toBeNull()
  })

  test('keeps the raw OSM string alongside the parsed form', () => {
    const place = withTags({ opening_hours: 'Mo-Fr 09:00-17:00' })

    expect(place.openingHours!.value.rawText).toBe('Mo-Fr 09:00-17:00')
    expect(Array.isArray(place.openingHours!.value.regularHours)).toBe(true)
  })

  test('detects 24/7', () => {
    expect(withTags({ opening_hours: '24/7' }).openingHours!.value.isOpen24_7).toBe(
      true,
    )
  })

  test('flags a disused place as permanently closed', () => {
    const place = withTags({ opening_hours: 'Mo-Fr 09:00-17:00', disused: 'yes' })

    expect(place.openingHours!.value.isPermanentlyClosed).toBe(true)
  })

  test('flags an abandoned place as permanently closed', () => {
    const place = withTags({
      opening_hours: 'Mo-Fr 09:00-17:00',
      abandoned: 'yes',
    })

    expect(place.openingHours!.value.isPermanentlyClosed).toBe(true)
  })

  test.each([
    ['disused:amenity', 'cafe'],
    ['abandoned:shop', 'bakery'],
    ['demolished:building', 'yes'],
    ['razed:leisure', 'fitness_centre'],
    ['was:tourism', 'hotel'],
  ])(
    'flags %s=%s as permanently closed despite live hours',
    (key, value) => {
      // OSM retires a feature by prefixing its primary tag, not by setting
      // `disused=yes`. The stale hours stay behind and read as "Open now".
      const place = withTags({ opening_hours: 'Mo-Fr 09:00-17:00', [key]: value })

      expect(place.openingHours!.value.isPermanentlyClosed).toBe(true)
    },
  )

  test('drops the stale schedule of a permanently closed place', () => {
    const place = withTags({
      opening_hours: 'Mo-Fr 09:00-17:00',
      'disused:amenity': 'cafe',
    })

    expect(place.openingHours!.value.regularHours).toEqual([])
    expect(place.openingHours!.value.isOpen24_7).toBe(false)
  })

  test('reports a permanently closed place with no opening_hours at all', () => {
    // Without this the page falls silent rather than saying the place is gone.
    const place = withTags({ 'disused:amenity': 'cafe' })

    expect(place.openingHours!.value.isPermanentlyClosed).toBe(true)
  })

  test('leaves a live place with a lifecycle-prefixed detail tag open', () => {
    const place = withTags({
      amenity: 'cafe',
      opening_hours: 'Mo-Fr 09:00-17:00',
      'demolished:date': '2019',
    })

    expect(place.openingHours!.value.isPermanentlyClosed).toBe(false)
  })

  test('flags opening_hours=closed as temporarily closed', () => {
    const place = withTags({ opening_hours: 'closed' })

    expect(place.openingHours!.value.isTemporarilyClosed).toBe(true)
  })
})

describe('geometry hint for preset matching', () => {
  test('matches a way as an area', () => {
    // Ways and relations are area features; matching them as points would fall
    // back to the point-only preset and render the wrong icon.
    const place = adapt(
      element({ type: 'way', tags: { building: 'apartments' } }),
    )

    expect(place.placeType.value).toBeTruthy()
    expect(place.icon).toBeDefined()
  })

  test('matches a relation as an area', () => {
    const place = adapt(
      element({ type: 'relation', tags: { building: 'apartments' } }),
    )

    expect(place.icon).toBeDefined()
  })

  test('an untagged node still resolves to the geometry-derived type', () => {
    // getPlaceType returns "Point" from the geometry hint alone, so the
    // adapter's `|| 'unknown'` fallback is unreachable for nodes.
    expect(adapt(element({ tags: undefined })).placeType.value).toBe('Point')
  })
})
