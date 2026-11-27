import { describe, expect, test } from 'bun:test'
import { cheapestRoomOffer, mergeOffers, stayNights } from './stay-offers'
import type { StayOffer } from '../../types/integration.types'

const offer = (seller: string, featured: boolean, nightly: number | null): StayOffer => ({
  seller,
  logo: null,
  official: false,
  featured,
  bookHere: false,
  nightly: nightly === null ? null : { amount: nightly, currency: 'USD' },
  total: null,
  freeCancellation: false,
  url: 'https://example.com',
})

describe('stayNights', () => {
  test('counts nights, at least one', () => {
    expect(stayNights({ checkin: '2026-11-25', checkout: '2026-11-28' })).toBe(3)
    expect(stayNights({ checkin: '2026-11-25', checkout: '2026-11-25' })).toBe(1)
  })
})

describe('mergeOffers', () => {
  test('partner first, featured in Google’s order, then the rest cheapest first with unpriced last', () => {
    const merged = mergeOffers(
      [{ ...offer('Partner', true, 300), bookHere: true }],
      [offer('Official', true, 249), offer('Pricey', false, 400), offer('Unpriced', false, null), offer('Cheap', false, 188), offer('Expedia', true, 249)],
    )
    expect(merged.map((o) => o.seller)).toEqual(['Partner', 'Official', 'Expedia', 'Cheap', 'Pricey', 'Unpriced'])
  })
})

describe('cheapestRoomOffer', () => {
  const stay = { checkin: '2026-11-25', checkout: '2026-11-27', adults: 2, currency: 'USD', guestNationality: 'US' }

  test('is null when no rooms are left', () => {
    expect(cheapestRoomOffer({ provider: 'LiteAPI', hotelId: 'lp', rooms: [], bookingUrl: null }, stay)).toBeNull()
  })
})
