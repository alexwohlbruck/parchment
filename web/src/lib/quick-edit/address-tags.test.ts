import { describe, it, expect } from 'vitest'
import { addressToTags, splitStreetLine, formatAddressLine } from './address-tags'

describe('splitStreetLine', () => {
  it('splits a house number from the street', () => {
    expect(splitStreetLine('155 New Bern Street')).toEqual({
      housenumber: '155',
      street: 'New Bern Street',
    })
  })

  it('keeps suffixed and ranged numbers with the house number', () => {
    expect(splitStreetLine('12a Baker Street').housenumber).toBe('12a')
    expect(splitStreetLine('10-12 High Street').housenumber).toBe('10-12')
  })

  it('treats a street with no leading number as all street', () => {
    expect(splitStreetLine('Unter den Linden')).toEqual({ street: 'Unter den Linden' })
  })

  it('returns nothing for an empty line', () => {
    expect(splitStreetLine(undefined)).toEqual({})
  })
})

describe('addressToTags', () => {
  it('maps a geocoder address onto addr:* tags', () => {
    expect(
      addressToTags({
        street1: '155 New Bern Street',
        locality: 'Charlotte',
        region: 'NC',
        postalCode: '28203',
        countryCode: 'us',
      }),
    ).toEqual({
      'addr:housenumber': '155',
      'addr:street': 'New Bern Street',
      'addr:city': 'Charlotte',
      'addr:state': 'NC',
      'addr:postcode': '28203',
      'addr:country': 'US',
    })
  })

  it('omits parts the geocoder did not provide', () => {
    expect(addressToTags({ locality: 'Charlotte' })).toEqual({
      'addr:city': 'Charlotte',
    })
  })
})

describe('formatAddressLine', () => {
  it('prefers the provider formatted line', () => {
    expect(formatAddressLine({ formatted: '155 New Bern St, Charlotte' })).toBe(
      '155 New Bern St, Charlotte',
    )
  })

  it('composes a line when the provider omits one', () => {
    expect(
      formatAddressLine({
        street1: '155 New Bern Street',
        locality: 'Charlotte',
        postalCode: '28209',
      }),
    ).toBe('155 New Bern Street, Charlotte, 28209')
  })
})
