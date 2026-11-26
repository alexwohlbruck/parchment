import { describe, expect, test } from 'bun:test'
import { isVacantAddress, replacementTags, sameAddress } from './address-match'

const coogans = {
  'addr:housenumber': '4015',
  'addr:postcode': '10032',
  'addr:street': 'Broadway',
  'disused:amenity': 'pub',
  old_name: "Coogan's",
}

describe('isVacantAddress', () => {
  test.each([
    ['a closed business', coogans, true],
    ['a plain address', { 'addr:housenumber': '12', 'addr:street': 'Court Street' }, true],
    ['a vacant shop', { shop: 'vacant', 'addr:housenumber': '12' }, true],
    ['an open business', { amenity: 'cafe', 'addr:housenumber': '12' }, false],
    ['a named building', { building: 'yes', name: 'Georgian Building' }, false],
    ['an entrance', { entrance: 'main', 'addr:housenumber': '12' }, false],
  ])('%s', (_, tags, vacant) => {
    expect(isVacantAddress(tags as Record<string, string>)).toBe(vacant)
  })
})

describe('sameAddress', () => {
  test('matches the house number and street however the street is abbreviated', () => {
    expect(sameAddress(coogans, '4015 Broadway')).toBe(true)
    expect(sameAddress({ 'addr:housenumber': '215', 'addr:street': 'Union Street' }, '215 Union St, Brooklyn')).toBe(true)
    expect(sameAddress({ 'addr:housenumber': '601', 'addr:street': 'West 168th Street' }, '601 W 168th St')).toBe(true)
  })

  test('rejects another number or street', () => {
    expect(sameAddress(coogans, '4011 Broadway')).toBe(false)
    expect(sameAddress(coogans, '4015 Amsterdam Avenue')).toBe(false)
  })
})

test('replaces the former tenant and keeps the address as mapped', () => {
  const business = { amenity: 'cafe', name: 'Boogie Lab Bakery & Bistro', 'addr:street': 'BROADWAY', 'addr:city': 'New York' }
  expect(replacementTags({ ...coogans, opening_hours: 'Mo-Su 11:00-04:00', 'nycdoitt:bin': '1063260' }, business)).toEqual({
    amenity: 'cafe',
    name: 'Boogie Lab Bakery & Bistro',
    'addr:housenumber': '4015',
    'addr:postcode': '10032',
    'addr:street': 'Broadway',
    'addr:city': 'New York',
    'nycdoitt:bin': '1063260',
  })
})
