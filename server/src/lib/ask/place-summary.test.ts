import { describe, test, expect } from 'bun:test'
import type { OpeningHours, Place } from '../../types/place.types'
import { openNow, summarizePlace } from './place-summary'

function place(hours: Partial<OpeningHours> | null): Place {
  return {
    id: 'osm/node/1',
    externalIds: {} as Place['externalIds'],
    name: { value: 'Corner Café', sourceId: 'osm' as any },
    description: null,
    placeType: { value: 'Café', sourceId: 'osm' as any },
    geometry: { value: { type: 'point', center: { lat: 40.7128, lng: -74.006 } }, sourceId: 'osm' as any },
    photos: [],
    address: null,
    contactInfo: { phone: null, email: null, website: null, socials: {} },
    openingHours: hours && {
      value: {
        regularHours: [],
        isOpen24_7: false,
        isPermanentlyClosed: false,
        isTemporarilyClosed: false,
        ...hours,
      },
      sourceId: 'osm' as any,
    },
    amenities: {},
    timezone: 'America/New_York',
    sources: [],
    lastUpdated: '2026-11-14T00:00:00Z',
  }
}

// 15:00 UTC is 10:00 in New York on this date.
const morning = new Date('2026-11-14T15:00:00Z')
const lateNight = new Date('2026-11-15T04:00:00Z')

describe('openNow', () => {
  test("evaluates hours in the place's own timezone", () => {
    const cafe = place({ rawText: 'Mo-Su 08:00-18:00' })
    expect(openNow(cafe, morning)).toBe(true)
    expect(openNow(cafe, lateNight)).toBe(false)
  })

  test('closed places are never open, whatever their hours say', () => {
    expect(openNow(place({ rawText: '24/7', isPermanentlyClosed: true }), morning)).toBe(false)
  })

  test('unknown without hours', () => {
    expect(openNow(place(null), morning)).toBeUndefined()
  })
})

describe('summarizePlace', () => {
  test('measures distance from the origin and omits empty fields', () => {
    const summary = summarizePlace(place({ rawText: 'Mo-Su 08:00-18:00' }), {
      now: morning,
      origin: { lat: 40.7218, lng: -74.006 },
    })
    expect(summary.distanceM).toBeGreaterThan(990)
    expect(summary.distanceM).toBeLessThan(1010)
    expect(summary).toMatchObject({ name: 'Corner Café', openNow: true, hours: 'Mo-Su 08:00-18:00' })
    expect('address' in summary).toBe(false)
  })
})
