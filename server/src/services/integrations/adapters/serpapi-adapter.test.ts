import { describe, expect, test } from 'bun:test'
import hotel from '../__fixtures__/serpapi-hotel.json'
import { adaptSerpCandidate, adaptSerpOffers, sellerUrl } from './serpapi-adapter'

const offers = adaptSerpOffers(hotel, 'USD')
const bySeller = Object.fromEntries(offers.map((o) => [o.seller, o]))

describe('adaptSerpOffers', () => {
  test('lists each seller once, featured first', () => {
    expect(offers.map((o) => [o.seller, o.featured])).toEqual([
      ['EVEN Hotel Brooklyn by IHG', true],
      ['Expedia.com', true],
      ['Booking.com', false],
      ['Super.com', false],
    ])
  })

  test('links a featured seller to its own page when it is also among the plain prices', () => {
    expect(bySeller['EVEN Hotel Brooklyn by IHG'].url).toBe(
      'https://www.ihg.com/evenhotels/hotels/us/en/brooklyn/nycev/hoteldetail?qCiD=25&qCoD=26&qAdlt=2',
    )
    expect(bySeller['Expedia.com'].url).toStartWith('https://www.expedia.com/Brooklyn-Hotels-EVEN-Hotel-Brooklyn.h12345')
  })

  test('decodes the seller page out of Google’s click link', () => {
    expect(bySeller['Booking.com'].url).toBe(
      'https://www.booking.com/hotel/us/even-brooklyn.html?checkin=2026-11-25&checkout=2026-11-26&group_adults=2',
    )
    expect(new URL(bySeller['Super.com'].url).hostname).toBe('www.super.com')
  })

  test('drops a seller whose link is not http(s)', () => {
    expect(bySeller['Sketchy.example']).toBeUndefined()
  })

  test('reads the nightly price before taxes and the total with them', () => {
    expect(bySeller['Booking.com']).toMatchObject({
      nightly: { amount: 249, currency: 'USD' },
      total: { amount: 289, currency: 'USD' },
      freeCancellation: true,
      official: false,
      logo: 'https://www.gstatic.com/travel-hotels/branding/booking.png',
    })
    expect(bySeller['EVEN Hotel Brooklyn by IHG'].official).toBe(true)
  })

  test('carries free cancellation from the plain price over to a featured seller', () => {
    expect(bySeller['Expedia.com'].freeCancellation).toBe(true)
  })
})

describe('sellerUrl', () => {
  test('keeps a link without pcurl as it is', () => {
    expect(sellerUrl('https://www.google.com/aclk?sa=l&adurl')).toBe('https://www.google.com/aclk?sa=l&adurl')
    expect(sellerUrl(undefined)).toBeNull()
  })
})

describe('adaptSerpCandidate', () => {
  test('needs a token, a name and coordinates', () => {
    expect(adaptSerpCandidate(hotel)).toEqual({
      id: 'ChoIp8bW2tGU-6vDARoNL2cvMTFmMHR0Z2ZzdBAB',
      name: 'EVEN Hotel Brooklyn by IHG',
      lat: 40.6884,
      lng: -73.9809,
      address: '46 Nevins St, Brooklyn, NY 11217',
    })
    expect(adaptSerpCandidate({ name: 'No token' })).toBeNull()
  })
})
