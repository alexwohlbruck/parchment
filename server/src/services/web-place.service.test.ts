import { describe, expect, test } from 'bun:test'
import { parseModelBusiness, webPlace } from './web-place.service'

describe('parseModelBusiness', () => {
  test('reads the JSON a model wraps in prose or fences', () => {
    const reply = 'Here it is:\n```json\n{"name":"Moss Café","category":"CafeOrCoffeeShop","street":"8 Elm Street","city":"Burlington","region":"VT","postcode":"05401","country":"US","phone":null,"email":null,"opening_hours":"Mo-Fr 07:00-14:00","closed":false}\n```'
    expect(parseModelBusiness(reply)).toEqual({
      name: 'Moss Café',
      types: ['CafeOrCoffeeShop'],
      address: { street: '8 Elm Street', locality: 'Burlington', region: 'VT', postalCode: '05401', country: 'US' },
      phone: undefined,
      email: undefined,
      openingHours: 'Mo-Fr 07:00-14:00',
      closed: false,
    })
  })

  test('drops a category it wasn’t offered and hours that aren’t OSM syntax', () => {
    const business = parseModelBusiness(
      '{"name":"Moss","category":"Coffee","street":"8 Elm St","opening_hours":"7am – 2pm weekdays"}',
    )
    expect(business?.types).toEqual([])
    expect(business?.openingHours).toBeUndefined()
  })

  test('needs a name and a street', () => {
    expect(parseModelBusiness('{"name":"Moss","street":null}')).toBeNull()
    expect(parseModelBusiness('no idea')).toBeNull()
  })
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
