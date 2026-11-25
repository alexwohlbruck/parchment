import { describe, expect, it } from 'vitest'
import { addNights, dayLabelKey, defaultPlan, guestMarket, tableTime, upcomingDays } from '@/lib/place/place-stay'

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
