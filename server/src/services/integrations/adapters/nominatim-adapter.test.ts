/**
 * Unit tests for the Nominatim adapter.
 *
 * Two naming rules here exist because of specific bugs and are called out in
 * the source with "do NOT" comments — both are pinned below:
 *
 *   - `namedetails` must NOT fall back to `Object.values()[0]`, or a place's
 *     `alt_name` / `old_name` becomes its title;
 *   - the adapter must NOT fall back to `display_name`, which for an unnamed
 *     object is the *surrounding area* (a picnic table in "The Plaza" would be
 *     titled "The Plaza").
 *
 * The other substantial piece is GeoJSON handling: Nominatim returns Point,
 * LineString, MultiLineString, Polygon (with holes) and MultiPolygon, and each
 * maps to a different internal geometry type. Note its `boundingbox` is
 * [minLat, maxLat, minLng, maxLng] — not the usual GeoJSON ordering.
 */

import { describe, test, expect } from 'bun:test'
import { NominatimAdapter } from './nominatim-adapter'
import { SOURCE } from '../../../lib/constants'

const adapter = new NominatimAdapter()

function result(over: Partial<any> = {}): any {
  return {
    osm_type: 'node',
    osm_id: 123456,
    lat: '35.2',
    lon: '-80.8',
    class: 'amenity',
    type: 'cafe',
    display_name: 'Joe’s Cafe, Main St, Charlotte, NC, USA',
    ...over,
  }
}

const adapt = (data: any, id?: string) =>
  adapter.placeInfo.adaptPlaceDetails(data, id)

describe('identity', () => {
  test('builds the id from the OSM type and id', () => {
    const place = adapt(result())

    expect(place.id).toBe(`${SOURCE.OSM}/node/123456`)
    expect(place.externalIds[SOURCE.OSM]).toBe('node/123456')
  })

  test('honours an explicit id override', () => {
    expect(adapt(result(), 'custom/id').id).toBe('custom/id')
  })

  test('links back to the OSM object', () => {
    const place = adapt(result({ osm_type: 'way', osm_id: 999 }))

    expect(place.sources[0].url).toBe('https://www.openstreetmap.org/way/999')
  })

  test('lifts a Wikidata id out of extratags', () => {
    const place = adapt(result({ extratags: { wikidata: 'Q42' } }))

    expect(place.externalIds[SOURCE.WIKIDATA]).toBe('Q42')
  })

  test('lifts a Wikipedia reference out of extratags', () => {
    const place = adapt(result({ extratags: { wikipedia: 'en:Joe’s Cafe' } }))

    expect(place.externalIds[SOURCE.WIKIPEDIA]).toBe('en:Joe’s Cafe')
  })

  test('carries no photos — Nominatim provides none', () => {
    expect(adapt(result()).photos).toEqual([])
  })
})

describe('name extraction', () => {
  test('prefers namedetails.name', () => {
    const place = adapt(
      result({ namedetails: { name: 'Joe’s Cafe', brand: 'Chain' } }),
    )

    expect(place.name.value).toBe('Joe’s Cafe')
  })

  test('falls back to name:en then brand within namedetails', () => {
    expect(
      adapt(result({ namedetails: { 'name:en': 'English' } })).name.value,
    ).toBe('English')
    expect(adapt(result({ namedetails: { brand: 'Starbucks' } })).name.value).toBe(
      'Starbucks',
    )
  })

  test('does NOT fall back to an arbitrary namedetails entry', () => {
    // alt_name / old_name are secondary designations, not titles.
    const place = adapt(
      result({ namedetails: { alt_name: 'Old Joe’s', old_name: 'Joe Snr' } }),
    )

    expect(place.name.value).toBeNull()
  })

  test('uses extratags when namedetails was not requested', () => {
    const place = adapt(result({ extratags: { name: 'From Extratags' } }))

    expect(place.name.value).toBe('From Extratags')
  })

  test('falls back through extratags brand and operator', () => {
    expect(adapt(result({ extratags: { brand: 'Chain' } })).name.value).toBe(
      'Chain',
    )
    expect(
      adapt(result({ extratags: { operator: 'City Council' } })).name.value,
    ).toBe('City Council')
  })

  test('does NOT fall back to display_name', () => {
    // For an unnamed object display_name is the surrounding area, so a picnic
    // table would be titled after the park it sits in.
    const place = adapt(
      result({ display_name: 'The Plaza, Charlotte, NC, USA' }),
    )

    expect(place.name.value).toBeNull()
  })

  test('prefers namedetails over extratags', () => {
    const place = adapt(
      result({
        namedetails: { name: 'From Namedetails' },
        extratags: { name: 'From Extratags' },
      }),
    )

    expect(place.name.value).toBe('From Namedetails')
  })
})

describe('description', () => {
  test('prefers the description tag', () => {
    const place = adapt(
      result({ extratags: { description: 'A cafe', note: 'ignored' } }),
    )

    expect(place.description!.value).toBe('A cafe')
  })

  test('falls back through description:en, note and comment', () => {
    expect(
      adapt(result({ extratags: { 'description:en': 'English' } }))!.description!
        .value,
    ).toBe('English')
    expect(
      adapt(result({ extratags: { note: 'A note' } }))!.description!.value,
    ).toBe('A note')
    expect(
      adapt(result({ extratags: { comment: 'A comment' } }))!.description!.value,
    ).toBe('A comment')
  })

  test('is null without extratags', () => {
    expect(adapt(result()).description).toBeNull()
  })
})

describe('geometry', () => {
  test('defaults to a point from lat/lon strings', () => {
    const place = adapt(result())

    expect(place.geometry.value).toMatchObject({
      type: 'point',
      center: { lat: 35.2, lng: -80.8 },
    })
  })

  test('maps a LineString to linestring nodes', () => {
    const place = adapt(
      result({
        geojson: {
          type: 'LineString',
          coordinates: [
            [-80.8, 35.2],
            [-80.9, 35.3],
          ],
        },
      }),
    )

    expect(place.geometry.value.type).toBe('linestring')
    expect(place.geometry.value.nodes).toEqual([
      { lat: 35.2, lng: -80.8 },
      { lat: 35.3, lng: -80.9 },
    ])
  })

  test('flattens a MultiLineString into one node list', () => {
    const place = adapt(
      result({
        geojson: {
          type: 'MultiLineString',
          coordinates: [
            [
              [-80.8, 35.2],
              [-80.85, 35.25],
            ],
            [[-80.9, 35.3]],
          ],
        },
      }),
    )

    expect(place.geometry.value.nodes).toHaveLength(3)
  })

  test('maps a Polygon to polygon geometry', () => {
    const place = adapt(
      result({
        geojson: {
          type: 'Polygon',
          coordinates: [
            [
              [-80.8, 35.2],
              [-80.9, 35.2],
              [-80.9, 35.3],
              [-80.8, 35.2],
            ],
          ],
        },
      }),
    )

    expect(place.geometry.value.type).toBe('polygon')
    expect(place.geometry.value.nodes.length).toBeGreaterThan(0)
  })

  test('maps a MultiPolygon to multipolygon geometry', () => {
    const place = adapt(
      result({
        geojson: {
          type: 'MultiPolygon',
          coordinates: [
            [
              [
                [-80.8, 35.2],
                [-80.9, 35.2],
                [-80.9, 35.3],
                [-80.8, 35.2],
              ],
            ],
          ],
        },
      }),
    )

    expect(place.geometry.value.type).toBe('multipolygon')
    expect(place.geometry.value.polygons).toHaveLength(1)
  })

  test('keeps a GeoJSON Point as a point', () => {
    const place = adapt(
      result({ geojson: { type: 'Point', coordinates: [-80.8, 35.2] } }),
    )

    expect(place.geometry.value.type).toBe('point')
  })

  test('reads the Nominatim boundingbox ordering correctly', () => {
    // Nominatim orders it [minLat, maxLat, minLng, maxLng].
    const place = adapt(
      result({ boundingbox: ['35.2', '35.3', '-80.9', '-80.8'] }),
    )

    expect(place.geometry.value.bounds).toEqual({
      minLat: 35.2,
      maxLat: 35.3,
      minLng: -80.9,
      maxLng: -80.8,
    })
  })

  test('ignores a malformed boundingbox', () => {
    const place = adapt(result({ boundingbox: ['35.2', '35.3'] }))

    expect(place.geometry.value.bounds).toBeUndefined()
  })
})

describe('place type', () => {
  test('combines class and type into the tag map', () => {
    const place = adapt(result({ class: 'amenity', type: 'cafe' }))

    expect(place.placeType.value).toBeTruthy()
  })

  test('falls back to the raw Nominatim type', () => {
    const place = adapt(result({ class: 'made_up', type: 'weird_thing' }))

    expect(place.placeType.value).toBeTruthy()
  })
})

describe('address', () => {
  test('is null without address components', () => {
    expect(adapt(result()).address).toBeNull()
  })

  test('maps Nominatim address components', () => {
    const place = adapt(
      result({
        address: {
          house_number: '123',
          road: 'Main St',
          city: 'Charlotte',
          state: 'North Carolina',
          postcode: '28202',
          country: 'United States',
          country_code: 'us',
        },
      }),
    )

    expect(place.address!.value).toMatchObject({
      locality: 'Charlotte',
      postalCode: '28202',
      country: 'United States',
    })
  })
})

describe('contact info and hours', () => {
  test('extracts phone and website from extratags', () => {
    const place = adapt(
      result({
        extratags: { phone: '+1 704 555 0100', website: 'https://cafe.test' },
      }),
    )

    expect(place.contactInfo.phone!.value).toBe('+1 704 555 0100')
    expect(place.contactInfo.website!.value).toBe('https://cafe.test')
  })

  test('reports empty contact info without extratags', () => {
    expect(adapt(result()).contactInfo).toMatchObject({
      phone: null,
      email: null,
      website: null,
    })
  })

  test('parses opening hours from extratags', () => {
    const place = adapt(
      result({ extratags: { opening_hours: 'Mo-Fr 09:00-17:00' } }),
    )

    expect(place.openingHours).not.toBeNull()
  })

  test('reports no opening hours without the tag', () => {
    expect(adapt(result()).openingHours).toBeNull()
  })
})
