import { describe, expect, test } from 'bun:test'
import type { Place } from '../types/place.types'
import { addressMatch, geocodedAddress, inArea, parseModelBusiness, siteName, userAddress, webPlace } from './web-place.service'

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

  test('needs a name that is on the page', () => {
    expect(parseModelBusiness('{"name":"Fern Bakery","street":"8 Elm St"}', page)).toBeNull()
    expect(parseModelBusiness('no idea', page)).toBeNull()
  })

  test('keeps the business but not a street the page never states, so its images can be read', () => {
    expect(parseModelBusiness('{"name":"Moss Café","street":"12 Pine Road"}', page)?.address?.street).toBeUndefined()
    expect(parseModelBusiness('{"name":"Moss Café","street":null}', page)?.name).toBe('Moss Café')
  })

  test('keeps the branch of a business with several locations, when the page names it', () => {
    const many = `${page}\nOur cafés\nGreenpoint\n9 Oak St`
    expect(parseModelBusiness('{"name":"Moss Café","branch":"Greenpoint","street":"9 Oak St"}', many)).toMatchObject({
      branch: 'Greenpoint',
      address: { street: '9 Oak St' },
    })
    expect(parseModelBusiness('{"name":"Moss Café","branch":"Astoria"}', many)?.branch).toBeUndefined()
  })

  test('notes a site that says it is opening soon', () => {
    expect(parseModelBusiness('{"name":"Moss Café","opens_soon":true}', page)?.opensSoon).toBe(true)
  })
})

test('maps a business that is opening soon under a construction prefix', () => {
  const place = webPlace(
    { name: 'Cafe Wands', types: [], preset: 'amenity/cafe', opensSoon: true, address: { street: '215 Union St' } },
    'https://cafewands.example/',
    { lat: 40.6835, lng: -73.9967 },
  )
  expect(place.unmapped).toMatchObject({ opensSoon: true, tags: { 'construction:amenity': 'cafe' } })
  expect(place.unmapped?.tags.amenity).toBeUndefined()
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

describe('addressMatch', () => {
  const hit = (name: string, lat: number, lng: number) =>
    ({ name: { value: name }, geometry: { value: { center: { lat, lng } } } }) as unknown as Place
  const business = { name: 'Pianoland', types: [], address: { street: '2527 65th St, Brooklyn' } }

  test('takes the geocoded point for the same house number', () => {
    const results = [hit('65th Street', 40.62, -73.99), hit('2527 65th Street', 40.6093, -73.9735)]
    expect(addressMatch(results, business)?.geometry.value.center).toEqual({ lat: 40.6093, lng: -73.9735 })
  })

  test('skips the same house number on another street', () => {
    const avenueA = { ...business, address: { street: '119 Avenue A' } }
    expect(addressMatch([hit('119 New York Avenue', 40.71, -73.65)], avenueA)).toBeUndefined()
    expect(addressMatch([hit('35 Cooper Square', 40.728, -73.991)], { ...business, address: { street: '35 Cooper Sq' } })).toBeDefined()
  })

  test('falls back when no result has the house number', () => {
    expect(addressMatch([hit('2525 65th Street', 40.6093, -73.9735)], business)).toBeUndefined()
  })

  test('trusts the site’s own coordinates over a match far from them', () => {
    const far = { ...business, geo: { lat: 40.7, lng: -73.9 } }
    expect(addressMatch([hit('2527 65th Street', 40.6093, -73.9735)], far)).toBeUndefined()
  })
})

test('spells the address the way the geocoder does, keeping the unit', () => {
  const match = {
    name: { value: '215 Union Street' },
    address: { value: { street1: '215 Union Street', locality: 'New York', region: 'NY', postalCode: '11231' } },
  } as unknown as Place
  expect(geocodedAddress({ street: '215 UNION ST, Suite 2', locality: 'BROOKLYN' }, match)).toEqual({
    street: '215 Union Street, Suite 2',
    locality: 'Brooklyn',
    region: 'NY',
    postalCode: '11231',
  })
})

describe('userAddress', () => {
  test('reads a typed address into street, city, state and postcode', () => {
    expect(userAddress('215 Union St, Brooklyn')).toEqual({ street: '215 Union St', locality: 'Brooklyn', region: undefined, postalCode: undefined })
    expect(userAddress('215 Union St, Brooklyn, NY 11231')).toEqual({
      street: '215 Union St',
      locality: 'Brooklyn',
      region: 'NY',
      postalCode: '11231',
    })
  })
})

describe('siteName', () => {
  test('uses the site’s spelling over what was typed', () => {
    expect(siteName(['Pianoland', 'Used Pianos for Sale'], 'PIANOLAND INC', 'pianoland')).toBe('Pianoland')
  })

  test('prefers the fullest form of the name, even from a misspelled search', () => {
    const names = ['Boogie Lab', 'Bakery and Bistro in New York, NY', 'Boogie Lab Bakery & Bistro', 'Sourdough in Washington Heights']
    expect(siteName(names, 'Boogie Lab', 'bookie lab bakery')).toBe('Boogie Lab Bakery & Bistro')
  })

  test('takes a longer name but not a description of the logo', () => {
    expect(siteName(['Qahwah House', 'Qahwah House coffee cup'], 'Qahwah House', 'qahwah house')).toBe('Qahwah House')
  })

  test('extends the name only past its end, not to a sister brand', () => {
    expect(siteName(["Ruby's", "Little Ruby's"], 'Dallas - now open!', "Ruby's cafe")).toBe("Ruby's")
  })

  test('writes a shouted name in its own case', () => {
    expect(siteName(['SUPERIORITY BURGER', 'Superiority Burger'], 'SUPERIORITY BURGER', 'superiority burger')).toBe('Superiority Burger')
    expect(siteName(['SMOR Bakery', 'Smør Bakery'], 'SMOR Bakery', 'smor bakery')).toBe('Smør Bakery')
    expect(siteName(['SUPERIORITY BURGER'], 'SUPERIORITY BURGER', 'superiority burger')).toBe('Superiority Burger')
    expect(siteName(['SEY'], 'SEY', 'sey coffee')).toBe('SEY')
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

describe('inArea', () => {
  const at = (street: string, branch?: string) => ({ name: 'Joe Coffee', types: [], branch, address: { street, locality: 'New York' } })

  test.each([
    [at('141 Waverly Pl'), 'Joe Coffee, Upper West Side', false],
    [at('514 Columbus Ave', 'Upper West Side'), 'Joe Coffee, Upper West Side', true],
    [at('141 Waverly Pl'), 'Joe Coffee, New York', true],
    [at('141 Waverly Pl'), 'Joe Coffee', true],
    [at('47th & 3rd Ave'), 'Ess-a-Bagel', false],
  ])('%#', (business, query, expected) => {
    expect(inArea(business, query)).toBe(expected)
  })
})
