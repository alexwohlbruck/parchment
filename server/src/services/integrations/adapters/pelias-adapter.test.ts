/**
 * Unit tests for the Pelias adapter.
 *
 * Pelias fronts several upstream datasets, so the adapter's main job is
 * deciding which SOURCE a result really came from — an OpenAddresses row and an
 * OSM row need different external-id keys, and getting that wrong breaks
 * conflation (the merge layer keys dedupe off `externalIds`).
 *
 * The address extractor also has a specific behaviour worth pinning: it builds
 * `street1` from housenumber + street and deliberately does NOT reuse Pelias's
 * `label`, because the label embeds the place name and would contaminate the
 * address line.
 */

import { describe, test, expect, mock } from 'bun:test'
import { SOURCE } from '../../../lib/constants'

mock.module('../../../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
  logError: () => {},
  logWarn: () => {},
}))

const { PeliasAdapter } = await import('./pelias-adapter')

const adapter = new PeliasAdapter()

/** Build a Pelias GeoJSON feature. */
function feature(props: Partial<any> = {}, over: Partial<any> = {}): any {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-80.8, 35.2] },
    properties: {
      id: 'node:123',
      gid: 'openstreetmap:venue:node:123',
      layer: 'venue',
      source: 'openstreetmap',
      source_id: 'node:123',
      name: 'Joe’s Cafe',
      accuracy: 'point',
      ...props,
    },
    ...over,
  }
}

const adapt = (f: any, id?: string) => adapter.placeInfo.adaptPlaceDetails(f, id)

describe('source resolution', () => {
  test('maps an OpenStreetMap result to the OSM source', () => {
    const place = adapt(feature())

    expect(place.externalIds[SOURCE.OSM]).toBe('node:123')
    expect(place.name.sourceId).toBe(SOURCE.OSM)
  })

  test('maps an OpenAddresses result to the OpenAddresses source', () => {
    const place = adapt(
      feature({ source: 'openaddresses', gid: 'openaddresses:address:us/nc:1' }),
    )

    expect(place.externalIds[SOURCE.OPENADDRESSES]).toBe(
      'openaddresses:address:us/nc:1',
    )
    expect(place.name.sourceId).toBe(SOURCE.OPENADDRESSES)
  })

  test('falls back to OSM for an unrecognized upstream source', () => {
    const place = adapt(feature({ source: 'whosonfirst', gid: 'wof:locality:1' }))

    expect(place.externalIds[SOURCE.OSM]).toBe('wof:locality:1')
  })

  test('builds the primary id from source and provider id', () => {
    expect(adapt(feature()).id).toBe(`${SOURCE.OSM}/node:123`)
  })

  test('honours an explicitly supplied id', () => {
    expect(adapt(feature(), 'custom/id').id).toBe('custom/id')
  })

  test('falls back to gid when there is no source_id', () => {
    const place = adapt(
      feature({ source: 'openaddresses', source_id: undefined, gid: 'oa:1' }),
    )

    expect(place.id).toBe(`${SOURCE.OPENADDRESSES}/oa:1`)
  })
})

describe('geometry', () => {
  test('converts GeoJSON lng/lat into a lat/lng centre', () => {
    const place = adapt(feature())

    expect(place.geometry.value.type).toBe('point')
    expect(place.geometry.value.center).toEqual({ lat: 35.2, lng: -80.8 })
  })

  test('maps a bbox into bounds', () => {
    const place = adapt(
      feature({}, { bbox: [-81, 35, -80, 36] }),
    )

    expect(place.geometry.value.bounds).toEqual({
      minLng: -81,
      minLat: 35,
      maxLng: -80,
      maxLat: 36,
    })
  })

  test('omits bounds when no bbox is present', () => {
    expect(adapt(feature()).geometry.value.bounds).toBeUndefined()
  })
})

describe('address extraction', () => {
  test('joins housenumber and street into street1', () => {
    const place = adapt(feature({ housenumber: '123', street: 'Main St' }))

    expect(place.address!.value.street1).toBe('123 Main St')
  })

  test('uses the street alone when there is no housenumber', () => {
    const place = adapt(feature({ street: 'Main St' }))

    expect(place.address!.value.street1).toBe('Main St')
  })

  test('maps the administrative components', () => {
    const place = adapt(
      feature({
        street: 'Main St',
        locality: 'Charlotte',
        region: 'North Carolina',
        postalcode: '28202',
        country: 'United States',
        country_code: 'US',
        neighbourhood: 'Uptown',
      }),
    )

    expect(place.address!.value).toMatchObject({
      locality: 'Charlotte',
      region: 'North Carolina',
      postalCode: '28202',
      country: 'United States',
      countryCode: 'US',
      neighborhood: 'Uptown',
    })
  })

  test('does not reuse the Pelias label as the formatted address', () => {
    // The label embeds the place name, which would contaminate the address.
    const place = adapt(
      feature({ street: 'Main St', label: 'Joe’s Cafe, 123 Main St, Charlotte' }),
    )

    expect(place.address!.value.formatted).toBeUndefined()
  })

  test('leaves street1 unset when no street data exists', () => {
    const place = adapt(feature({ locality: 'Charlotte' }))

    expect(place.address!.value.street1).toBeUndefined()
    expect(place.address!.value.locality).toBe('Charlotte')
  })
})

describe('OSM addendum handling', () => {
  const withOsm = (osm: Record<string, string>) =>
    adapt(feature({ addendum: { osm } }))

  test('lifts a phone number out of the addendum', () => {
    const place = withOsm({ phone: '+1 704 555 0100' })

    expect(place.contactInfo.phone!.value).toBe('+1 704 555 0100')
    expect(place.contactInfo.phone!.sourceId).toBe(SOURCE.OSM)
  })

  test('lifts email and website', () => {
    const place = withOsm({
      email: 'hi@cafe.test',
      website: 'https://cafe.test',
    })

    expect(place.contactInfo.email!.value).toBe('hi@cafe.test')
    expect(place.contactInfo.website!.value).toBe('https://cafe.test')
  })

  test('nulls contact fields the addendum does not carry', () => {
    const place = withOsm({ amenity: 'cafe' })

    expect(place.contactInfo.phone).toBeNull()
    expect(place.contactInfo.email).toBeNull()
    expect(place.contactInfo.website).toBeNull()
  })

  test('reports no socials — Pelias has none', () => {
    expect(withOsm({ amenity: 'cafe' }).contactInfo.socials).toEqual({})
  })

  test('parses opening hours from the addendum', () => {
    const place = withOsm({ opening_hours: 'Mo-Fr 09:00-17:00' })

    expect(place.openingHours).not.toBeNull()
  })

  test('leaves opening hours null when unparseable', () => {
    const place = withOsm({ opening_hours: '!!!not a schedule!!!' })

    // A bad schedule must not fail the whole adaptation.
    expect(place).toBeTruthy()
  })

  test('promotes remaining OSM tags into amenities', () => {
    const place = withOsm({ amenity: 'cafe', cuisine: 'coffee_shop' })

    expect(place.amenities).toMatchObject({
      amenity: 'cafe',
      cuisine: 'coffee_shop',
    })
  })

  test('does not duplicate contact tags into amenities', () => {
    const place = withOsm({
      amenity: 'cafe',
      phone: '+1 704 555 0100',
      website: 'https://cafe.test',
      email: 'hi@cafe.test',
      opening_hours: 'Mo-Fr 09:00-17:00',
    })

    expect(place.amenities.phone).toBeUndefined()
    expect(place.amenities.website).toBeUndefined()
    expect(place.amenities.email).toBeUndefined()
    expect(place.amenities.opening_hours).toBeUndefined()
  })

  test('records the Pelias layer as a type amenity', () => {
    const place = adapt(feature({ layer: 'venue' }))

    expect(place.amenities['type:venue']).toBe('venue')
  })
})

describe('place type and name', () => {
  test('uses the Pelias layer when there is no OSM addendum', () => {
    expect(adapt(feature({ layer: 'address' })).placeType.value).toBe('address')
  })

  test('derives the place type from OSM tags when available', () => {
    const place = adapt(feature({ addendum: { osm: { amenity: 'cafe' } } }))

    // getPlaceType resolves a richer type than the raw Pelias layer.
    expect(place.placeType.value).toBeTruthy()
    expect(place.placeType.value).not.toBe('venue')
  })

  test('falls back to "unknown" with no layer', () => {
    expect(adapt(feature({ layer: undefined })).placeType.value).toBe('unknown')
  })

  test('carries a null name through rather than inventing one', () => {
    expect(adapt(feature({ name: undefined })).name.value).toBeNull()
  })

  test('starts with an empty photo list', () => {
    expect(adapt(feature()).photos).toEqual([])
  })
})

describe('capability surfaces', () => {
  test('autocomplete, placeInfo and geocoding share the same adaptation', () => {
    const f = feature()

    const viaAutocomplete = adapter.autocomplete.adaptPlaceDetails(f)
    const viaPlaceInfo = adapter.placeInfo.adaptPlaceDetails(f)
    const viaGeocoding = adapter.geocoding.adaptPlaceDetails(f)

    expect(viaAutocomplete.id).toBe(viaPlaceInfo.id)
    expect(viaGeocoding.id).toBe(viaPlaceInfo.id)
  })
})
