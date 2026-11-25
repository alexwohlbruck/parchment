import { beforeEach, describe, expect, mock, test } from 'bun:test'

let tags: Record<string, string> = {}
mock.module('../place.service', () => ({ lookupPlaceById: async () => ({ name: { value: 'Aita' }, tags }) }))

let stored: Record<string, { providerPlaceId: string | null; confirmed: boolean }> = {}
const setProviderMatch = mock(async (..._args: unknown[]) => true)
mock.module('./provider-matches.service', () => ({ getProviderMatches: async () => ({ ...stored }), setProviderMatch }))

const { getBookingVenues, taggedVenue } = await import('./booking-venues.service')

const restaurant = { amenity: 'restaurant', reservation: 'yes' }

beforeEach(() => {
  tags = {}
  stored = {}
  setProviderMatch.mockClear()
})

describe('taggedVenue', () => {
  test('reads a venue from a booking page on a site the place is booked on', () => {
    expect(taggedVenue({ tags: { ...restaurant, 'reservation:website': 'https://resy.com/cities/ny/aita' } } as any)).toEqual({
      provider: 'resy',
      id: 'ny/aita',
    })
  })

  test('ignores pages elsewhere, and a hotel site on a restaurant', () => {
    expect(taggedVenue({ tags: { ...restaurant, 'website:booking': 'https://aita.example/book' } } as any)).toBeNull()
    expect(taggedVenue({ tags: { ...restaurant, 'website:booking': 'https://www.booking.com/hotel/us/x.html' } } as any)).toBeNull()
  })
})

describe('getBookingVenues', () => {
  test('returns stored venues and the sites a person marked as not listing the place', async () => {
    tags = restaurant
    stored = {
      opentable: { providerPlaceId: 'r/aita-trattoria-brooklyn', confirmed: true },
      resy: { providerPlaceId: null, confirmed: true },
      google: { providerPlaceId: 'g-1', confirmed: false },
    }
    expect(await getBookingVenues('osm' as any, 'node/1')).toEqual({
      venues: { opentable: 'r/aita-trattoria-brooklyn' },
      unlisted: ['resy'],
    })
    expect(setProviderMatch).not.toHaveBeenCalled()
  })

  test('fills a site in once from the tagged booking page, unconfirmed', async () => {
    tags = { ...restaurant, 'reservation:website': 'https://www.opentable.com/r/aita-trattoria-brooklyn' }
    expect((await getBookingVenues('osm' as any, 'node/1')).venues).toEqual({ opentable: 'r/aita-trattoria-brooklyn' })
    expect(setProviderMatch).toHaveBeenCalledWith('osm', 'node/1', 'opentable', {
      providerPlaceId: 'r/aita-trattoria-brooklyn',
      confirmed: false,
    })
  })

  test('never overrides a stored venue with the tag', async () => {
    tags = { ...restaurant, 'reservation:website': 'https://www.opentable.com/r/old-name' }
    stored = { opentable: { providerPlaceId: 'r/new-name', confirmed: true } }
    expect((await getBookingVenues('osm' as any, 'node/1')).venues).toEqual({ opentable: 'r/new-name' })
    expect(setProviderMatch).not.toHaveBeenCalled()
  })

  test('has nothing for a place that cannot be booked', async () => {
    tags = { amenity: 'bench' }
    expect(await getBookingVenues('osm' as any, 'node/1')).toEqual({ venues: {}, unlisted: [] })
  })
})
