import { describe, expect, it } from 'vitest'
import { addNights, dayLabelKey, defaultPlan, groupOffers, guestMarket, tableTime, upcomingDays } from '@/lib/place/place-stay'
import type { StayOffer } from '@server/types/integration.types'

const afternoon = new Date(2026, 10, 25, 15, 0)

describe('defaultPlan', () => {
  it('is two people tonight for one night', () => {
    expect(defaultPlan(afternoon)).toEqual({ party: 2, day: '2026-11-25', nights: 1 })
  })
})

describe('addNights', () => {
  it('crosses month and year ends', () => {
    expect(addNights('2026-11-30', 1)).toBe('2026-12-01')
    expect(addNights('2026-12-31', 2)).toBe('2027-01-02')
  })
})

describe('upcomingDays', () => {
  it('offers two weeks starting today', () => {
    const days = upcomingDays(afternoon)
    expect(days).toHaveLength(14)
    expect(days[0]).toBe('2026-11-25')
    expect(days[13]).toBe('2026-12-08')
  })
})

describe('tableTime', () => {
  it('asks for 7 pm on the chosen day', () => {
    expect(tableTime('2026-11-26', afternoon)).toBe('2026-11-26T19:00')
  })

  it('moves to the next half hour once 7 pm has passed', () => {
    expect(tableTime('2026-11-25', new Date(2026, 10, 25, 20, 10))).toBe('2026-11-25T20:30')
    expect(tableTime('2026-11-25', new Date(2026, 10, 25, 23, 40))).toBe('2026-11-26T00:00')
  })
})

describe('dayLabelKey', () => {
  it('names tonight and tomorrow, and leaves other days to a date', () => {
    expect(dayLabelKey('2026-11-25', 'stay', afternoon)).toBe('tonight')
    expect(dayLabelKey('2026-11-25', 'ahead', afternoon)).toBe('today')
    expect(dayLabelKey('2026-11-26', 'table', afternoon)).toBe('tomorrow')
    expect(dayLabelKey('2026-11-28', 'table', afternoon)).toBeNull()
  })
})

describe('guestMarket', () => {
  it('reads the currency and country from the locale region', () => {
    expect(guestMarket('en-US')).toEqual({ currency: 'USD', nationality: 'US' })
    expect(guestMarket('es-ES')).toEqual({ currency: 'EUR', nationality: 'ES' })
    expect(guestMarket('en-GB')).toEqual({ currency: 'GBP', nationality: 'GB' })
  })

  it('falls back to US dollars without a region', () => {
    expect(guestMarket('en')).toEqual({ currency: 'USD', nationality: 'US' })
  })
})

describe('groupOffers', () => {
  const offer = (seller: string, featured: boolean, nightly: number, freeCancellation = false): StayOffer => ({
    seller,
    logo: null,
    official: false,
    featured,
    bookHere: false,
    nightly: { amount: nightly, currency: 'USD' },
    total: null,
    freeCancellation,
    url: 'https://example.com',
  })
  const offers = [
    offer('Official', true, 249),
    offer('Expedia', true, 249, true),
    offer('Super', false, 188),
    offer('Booking', false, 200, true),
    offer('Agoda', false, 210),
    offer('Trip', false, 189),
    offer('Hotels', false, 230, true),
  ]
  const names = (list: StayOffer[]) => list.map(o => o.seller)

  it('puts featured sellers apart and folds all but three of the rest', () => {
    const groups = groupOffers(offers, false, false)
    expect(names(groups.featured)).toEqual(['Official', 'Expedia'])
    expect(names(groups.others)).toEqual(['Super', 'Booking', 'Agoda'])
    expect(groups.hidden).toBe(2)
    expect(groups.hiddenFrom).toEqual({ amount: 189, currency: 'USD' })
  })

  it('shows everyone when expanded', () => {
    expect(groupOffers(offers, false, true)).toMatchObject({ hidden: 0, hiddenFrom: null })
  })

  it('keeps only sellers that cancel free', () => {
    const groups = groupOffers(offers, true, false)
    expect(names(groups.featured)).toEqual(['Expedia'])
    expect(names(groups.others)).toEqual(['Booking', 'Hotels'])
  })
})
