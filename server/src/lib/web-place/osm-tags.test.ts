import { describe, expect, test } from 'bun:test'
import { businessTags, splitStreet } from './osm-tags'

describe('businessTags', () => {
  test('tags a restaurant from its own site', () => {
    expect(
      businessTags(
        {
          name: 'Little Lao',
          types: ['LocalBusiness', 'Restaurant'],
          address: { street: '410 Main Street, Suite 2', locality: 'Durham', region: 'NC', postalCode: '27701', country: 'us' },
          phone: '+1 919-555-0199',
          openingHours: 'Tu-Su 11:00-21:00',
          cuisine: ['Lao', 'Thai Fusion'],
        },
        'https://littlelao.example/',
      ),
    ).toEqual({
      amenity: 'restaurant',
      name: 'Little Lao',
      website: 'https://littlelao.example/',
      'addr:housenumber': '410',
      'addr:street': 'Main Street',
      'addr:unit': '2',
      'addr:city': 'Durham',
      'addr:postcode': '27701',
      'addr:state': 'NC',
      'addr:country': 'US',
      phone: '+1 919-555-0199',
      opening_hours: 'Tu-Su 11:00-21:00',
      cuisine: 'lao;thai_fusion',
    })
  })

  test('leaves the category for the mapper when the site has none, and cuisine off a shop', () => {
    const tags = businessTags({ name: 'Odd Shop', types: ['Organization'], cuisine: ['Italian'] }, 'https://odd.example/')
    expect(tags).toEqual({ name: 'Odd Shop', website: 'https://odd.example/' })
  })
})

describe('splitStreet', () => {
  test.each([
    ['123 Main Street', { 'addr:housenumber': '123', 'addr:street': 'Main Street' }],
    ['12-14B Court St', { 'addr:housenumber': '12-14B', 'addr:street': 'Court St' }],
    ['Hauptstraße 5', { 'addr:housenumber': '5', 'addr:street': 'Hauptstraße' }],
    ['Pier 39', { 'addr:housenumber': '39', 'addr:street': 'Pier' }],
    ['The Arcade', { 'addr:street': 'The Arcade' }],
  ])('%s', (line, expected) => {
    expect(splitStreet(line)).toEqual(expected)
  })
})
