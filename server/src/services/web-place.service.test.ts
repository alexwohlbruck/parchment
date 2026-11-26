import { describe, expect, test } from 'bun:test'
import type { Place } from '../types/place.types'
import { addressPoint, parseModelBusiness, siteName, webPlace } from './web-place.service'

describe('parseModelBusiness', () => {
  const page = `Moss Café
8 Elm St, Burlington VT 05401 · (802) 555-0142
Open weekdays 7am – 2pm`

  test('reads the JSON a model wraps in prose or fences', () => {
    const reply = 'Here it is:\n```json\n{"name":"Moss Café","preset":"amenity/cafe","street":"8 Elm Street","city":"Burlington","region":"VT","postcode":"05401","country":"us","phone":"+1 802 555 0142","email":null,"opening_hours":"Mo-Fr 07:00-14:00","hours_quote":"Open weekdays 7am – 2pm","closed":false}\n```'
    expect(parseModelBusiness(reply, page)).toEqual({
      name: 'Moss Café',
      types: [],
      preset: 'amenity/cafe',
      address: { street: '8 Elm Street', locality: 'Burlington', region: 'VT', postalCode: '05401', country: 'US' },
      phone: '+1 802 555 0142',
      email: undefined,
      openingHours: 'Mo-Fr 07:00-14:00',
      closed: false,
    })
  })

  test('drops what the page doesn’t say and presets the schema doesn’t have', () => {
    const business = parseModelBusiness(
      '{"name":"Moss Café","preset":"amenity/coffee_house","street":"8 Elm St","phone":"802-555-9999","email":"hi@moss.example","opening_hours":"Mo-Su 06:00-22:00","hours_quote":"Open daily 6 to 10"}',
      page,
    )
    expect(business?.preset).toBeUndefined()
    expect(business?.phone).toBeUndefined()
    expect(business?.email).toBeUndefined()
    expect(business?.openingHours).toBeUndefined()
  })

  test('keeps hours only in clean OSM syntax', () => {
    const reply = '{"name":"Moss Café","street":"8 Elm St","opening_hours":"7am-2pm","hours_quote":"7am – 2pm"}'
    expect(parseModelBusiness(reply, page)?.openingHours).toBeUndefined()
  })

  test('needs a name and a street that are on the page', () => {
    expect(parseModelBusiness('{"name":"Moss Café","street":null}', page)).toBeNull()
    expect(parseModelBusiness('{"name":"Moss Café","street":"12 Pine Road"}', page)).toBeNull()
    expect(parseModelBusiness('{"name":"Fern Bakery","street":"8 Elm St"}', page)).toBeNull()
    expect(parseModelBusiness('no idea', page)).toBeNull()
  })
})

test('leaves the type to the mapper when the site says only that it is a business', () => {
  const place = webPlace(
    { name: 'Pianoland', types: ['LocalBusiness'], address: { street: '2527 65th St' } },
    'https://pianoland.example/',
    { lat: 40.6095, lng: -73.9735 },
  )
  expect(place.unmapped?.presetId).toBeNull()
})

describe('webPlace', () => {
  const place = webPlace(
    {
      name: 'Moss Café',
      types: ['CafeOrCoffeeShop'],
      address: { street: '8 Elm Street', locality: 'Burlington', postalCode: '05401' },
      openingHours: 'Mo-Fr 07:00-14:00',
    },
    'https://mosscafe.example/',
    { lat: 44.476, lng: -73.212 },
  )

  test('is a web place credited to the business’s own site', () => {
    expect(place.id).toMatch(/^web\/[0-9a-f]{16}$/)
    expect(place.externalIds).toEqual({ web: place.id.slice(4) })
    expect(place.sources).toEqual([{ id: 'web', name: 'mosscafe.example', url: 'https://mosscafe.example/' }])
    expect(JSON.stringify(place)).not.toContain('"sourceId":"osm"')
  })

  test('reads like an OSM place built from the tags a mapper would add', () => {
    expect(place.name.value).toBe('Moss Café')
    expect(place.contactInfo.website?.value).toBe('https://mosscafe.example/')
    expect(place.openingHours?.value.regularHours.length).toBe(5)
    expect(place.geometry.value.center).toEqual({ lat: 44.476, lng: -73.212 })
    expect(place.unmapped).toEqual({
      tags: {
        amenity: 'cafe',
        name: 'Moss Café',
        website: 'https://mosscafe.example/',
        'addr:housenumber': '8',
        'addr:street': 'Elm Street',
        'addr:city': 'Burlington',
        'addr:postcode': '05401',
        opening_hours: 'Mo-Fr 07:00-14:00',
      },
      presetId: 'amenity/cafe',
    })
  })
})

describe('addressPoint', () => {
  const hit = (name: string, lat: number, lng: number) =>
    ({ name: { value: name }, geometry: { value: { center: { lat, lng } } } }) as unknown as Place
  const business = { name: 'Pianoland', types: [], address: { street: '2527 65th St, Brooklyn' } }

  test('takes the geocoded point for the same house number', () => {
    const results = [hit('65th Street', 40.62, -73.99), hit('2527 65th Street', 40.6093, -73.9735)]
    expect(addressPoint(results, business)).toEqual({ lat: 40.6093, lng: -73.9735 })
  })

  test('falls back when no result has the house number', () => {
    expect(addressPoint([hit('2525 65th Street', 40.6093, -73.9735)], business)).toBeUndefined()
  })

  test('trusts the site’s own coordinates over a match far from them', () => {
    const far = { ...business, geo: { lat: 40.7, lng: -73.9 } }
    expect(addressPoint([hit('2527 65th Street', 40.6093, -73.9735)], far)).toBeUndefined()
  })
})

describe('siteName', () => {
  test('uses the site’s spelling over what was typed', () => {
    expect(siteName(['Pianoland', 'Used Pianos for Sale'], 'PIANOLAND INC', 'pianoland')).toBe('Pianoland')
    expect(siteName(['Boogie Lab', 'Bakery and Bistro'], 'Boogie Lab Bakery', 'boogie lab')).toBe('Boogie Lab')
  })

  test('keeps the name read off the site when nothing else matches', () => {
    expect(siteName(['Welcome', 'Home'], 'Moss Café', 'moss cafe')).toBe('Moss Café')
  })
})

test('tags a business with the preset a model picked and the fields it checked', () => {
  const place = webPlace(
    { name: 'Pianoland', types: [], preset: 'shop/musical_instrument', tags: { wheelchair: 'yes' }, address: { street: '2527 65th St' } },
    'https://pianoland.example/',
    { lat: 40.6095, lng: -73.9735 },
  )
  expect(place.unmapped?.presetId).toBe('shop/musical_instrument')
  expect(place.unmapped?.tags).toMatchObject({ shop: 'musical_instrument', wheelchair: 'yes' })
})
