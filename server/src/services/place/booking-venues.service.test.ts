import { beforeEach, describe, expect, mock, test } from 'bun:test'

let tags: Record<string, string> = {}
mock.module('../place.service', () => ({ lookupPlaceById: async () => ({ name: { value: 'Aita' }, tags }) }))

let stored: Record<string, { providerPlaceId: string | null; confirmed: boolean }> = {}
const setProviderMatch = mock(async (..._args: unknown[]) => true)
mock.module('./provider-matches.service', () => ({ getProviderMatches: async () => ({ ...stored }), setProviderMatch }))

let claims: Record<string, any[]> | null = {}
const fetchWikidataClaims = mock(async (..._args: unknown[]) => claims)
mock.module('../wikidata.service', () => ({ fetchWikidataClaims }))

const { getBookingVenues, taggedVenue, resetBookingVenuesForTests } = await import('./booking-venues.service')

const restaurant = { amenity: 'restaurant', reservation: 'yes' }

beforeEach(() => {
  tags = {}
  stored = {}
  claims = {}
  setProviderMatch.mockClear()
  fetchWikidataClaims.mockClear()
  resetBookingVenuesForTests()
})

const claim = (value: string) => [{ mainsnak: { datavalue: { value } } }]

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

  test('never overrides a confirmed venue with the tag', async () => {
    tags = { ...restaurant, 'reservation:website': 'https://www.opentable.com/r/old-name' }
    stored = { opentable: { providerPlaceId: 'r/new-name', confirmed: true } }
    expect((await getBookingVenues('osm' as any, 'node/1')).venues).toEqual({ opentable: 'r/new-name' })
    expect(setProviderMatch).not.toHaveBeenCalled()
  })

  test('replaces a venue Foursquare stored with the tagged one', async () => {
    tags = { ...restaurant, 'reservation:website': 'https://www.opentable.com/r/tagged' }
    stored = { opentable: { providerPlaceId: 'r/from-foursquare', confirmed: false } }
    expect((await getBookingVenues('osm' as any, 'node/1')).venues).toEqual({ opentable: 'r/tagged' })
  })

  test('seeds a hotel’s booking sites from Wikidata, below its tagged page', async () => {
    tags = { tourism: 'hotel', wikidata: 'Q42', 'website:booking': 'https://www.booking.com/hotel/us/tagged.html' }
    claims = { P3607: claim('us/from-wikidata'), P5651: claim('h1097488'), P3898: claim('ho421518') }

    expect(await getBookingVenues('osm' as any, 'node/1')).toEqual({
      venues: { bookingcom: 'us/tagged', expedia: '1097488', hotelscom: '421518' },
      unlisted: [],
    })
    expect(fetchWikidataClaims).toHaveBeenCalledWith('Q42', ['P3607', 'P5651', 'P3898'])
    expect(setProviderMatch.mock.calls.map((c) => c[2])).toEqual(['bookingcom', 'expedia', 'hotelscom'])
  })

  test('reads Wikidata once a day per item', async () => {
    tags = { tourism: 'hotel', wikidata: 'Q42' }
    claims = { P5651: claim('h1') }
    await getBookingVenues('osm' as any, 'node/1')
    await getBookingVenues('osm' as any, 'node/1')
    expect(fetchWikidataClaims).toHaveBeenCalledTimes(1)
  })

  test('skips Wikidata for places that are not lodging', async () => {
    tags = { ...restaurant, wikidata: 'Q42' }
    await getBookingVenues('osm' as any, 'node/1')
    expect(fetchWikidataClaims).not.toHaveBeenCalled()
  })

  test('has nothing for a place that cannot be booked', async () => {
    tags = { amenity: 'bench' }
    expect(await getBookingVenues('osm' as any, 'node/1')).toEqual({ venues: {}, unlisted: [] })
  })
})
