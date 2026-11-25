import { beforeEach, describe, expect, mock, test } from 'bun:test'

const configured = new Set<string>()
mock.module('../integrations', () => ({
  integrationManager: {
    getConfiguredIntegrationForSource: (source: string, capability: string) =>
      configured.has(`${source}:${capability}`) ? { integrationId: source } : null,
  },
}))

let osmTags: Record<string, string> = {}
const place = (source: string, id: string, name: string, lat: number, lng: number) => ({
  name: { value: name },
  tags: source === 'osm' ? osmTags : undefined,
  address: { value: { street1: '1 Main St', locality: 'Charlotte' } },
  geometry: { value: { center: { lat, lng } } },
  externalIds: { [source]: id },
  sources: [{ id: source }],
})

const lookupPlaceById = mock(async (source: string, id: string) =>
  source === 'osm' ? place('osm', id, 'Not Just Coffee', 35.2271, -80.8431) : place(source, id, 'NJC listing', 35.2271, -80.8431),
)
const lookupPlacesByNameAndLocation = mock(async (..._args: unknown[]) => [] as any[])
mock.module('../place.service', () => ({ lookupPlaceById, lookupPlacesByNameAndLocation }))

let stored: Record<string, { providerPlaceId: string | null; confirmed: boolean }> = {}
const setProviderMatch = mock(async (..._args: unknown[]) => true)
mock.module('./provider-matches.service', () => ({ getProviderMatches: async () => stored, setProviderMatch }))

const hotels = [
  { id: 'lp-far', name: 'Ivey’s Hotel Annex', lat: 35.2290, lng: -80.8431, address: '9 Far St' },
  { id: 'lp-1', name: 'The Ivey’s Hotel', lat: 35.2272, lng: -80.8431, address: '127 N Tryon St' },
]
let hotelRates: any = null
mock.module('../stay.service', () => ({
  LITEAPI_PROVIDER: 'liteapi',
  hotelRatesCapability: () => hotelRates,
}))

const { getPlaceListings, searchListingCandidates, correctListing } = await import('./listing-matches.service')

beforeEach(() => {
  configured.clear()
  stored = {}
  osmTags = {}
  hotelRates = null
  setProviderMatch.mockClear()
  lookupPlacesByNameAndLocation.mockReset()
})

describe('getPlaceListings', () => {
  test('lists configured auto-matched providers and any provider with a stored match', async () => {
    configured.add('foursquare:placeInfo').add('foursquare:search')
    stored = { yelp: { providerPlaceId: 'yelp-1', confirmed: false } }

    const listings = await getPlaceListings('osm' as any, 'node/1')

    expect(listings).toEqual([
      { provider: 'foursquare', listing: null, confirmed: false, searchable: true, acceptsUrl: false },
      {
        provider: 'yelp',
        listing: { id: 'yelp-1', name: null, address: null, distance: null },
        confirmed: false,
        searchable: false,
        acceptsUrl: false,
      },
    ])
  })

  test('adds the booking sites a restaurant that takes reservations is booked on, set by URL', async () => {
    osmTags = { amenity: 'restaurant', reservation: 'recommended' }
    stored = { opentable: { providerPlaceId: 'r/not-just-coffee', confirmed: true } }

    const listings = await getPlaceListings('osm' as any, 'node/1')

    expect(listings.map((l) => [l.provider, l.searchable, l.acceptsUrl])).toEqual([
      ['opentable', false, true],
      ['resy', false, true],
    ])
    expect(listings[0].listing?.url).toBe('https://www.opentable.com/r/not-just-coffee')
  })

  test('lists LiteAPI first for a hotel when hotel rates are configured, named from LiteAPI', async () => {
    osmTags = { tourism: 'hotel' }
    hotelRates = { getHotel: async (id: string) => hotels.find((h) => h.id === id) ?? null }
    stored = { liteapi: { providerPlaceId: 'lp-1', confirmed: false } }

    const listings = await getPlaceListings('osm' as any, 'node/1')

    expect(listings.map((l) => l.provider)).toEqual(['liteapi', 'booking', 'expedia'])
    expect(listings[0]).toMatchObject({ searchable: true, acceptsUrl: false })
    expect(listings[0].listing).toMatchObject({ id: 'lp-1', name: 'The Ivey’s Hotel', address: '127 N Tryon St' })
  })

  test('leaves LiteAPI out when it is not configured', async () => {
    osmTags = { tourism: 'hotel' }
    const listings = await getPlaceListings('osm' as any, 'node/1')
    expect(listings.map((l) => l.provider)).toEqual(['booking', 'expedia'])
  })
})

describe('searchListingCandidates', () => {
  test('keeps only the provider asked for, nearest first', async () => {
    lookupPlacesByNameAndLocation.mockImplementation(async () => [
      place('google', 'far', 'Far', 35.23, -80.8431),
      place('google', 'near', 'Near', 35.2272, -80.8431),
      place('osm', 'node/9', 'Other', 35.2271, -80.8431),
    ])

    const found = await searchListingCandidates('osm' as any, 'node/1', 'google')

    expect(found.map((c) => c.id)).toEqual(['near', 'far'])
    expect(found[0].distance).toBeLessThan(found[1].distance!)
    const [query, , options] = lookupPlacesByNameAndLocation.mock.calls[0] as any[]
    expect(query).toBe('Not Just Coffee')
    expect(options.sourceBlacklist).not.toContain('google')
    expect(options.sourceBlacklist).toContain('foursquare')
  })
})

describe('searchListingCandidates for LiteAPI', () => {
  test('searches LiteAPI hotels near the place, closest name first', async () => {
    const findHotels = mock(async () => hotels)
    hotelRates = { findHotels }

    const found = await searchListingCandidates('osm' as any, 'node/1', 'liteapi', { query: 'Iveys Hotel' })

    expect(findHotels).toHaveBeenCalledWith({ lat: 35.2271, lng: -80.8431 }, 1000)
    expect(found.map((c) => c.id)).toEqual(['lp-1', 'lp-far'])
    expect(found[0]).toMatchObject({ name: 'The Ivey’s Hotel', address: '127 N Tryon St', distance: 11 })
    expect(lookupPlacesByNameAndLocation).not.toHaveBeenCalled()
  })
})

describe('correctListing', () => {
  test('stores a person’s choice as confirmed, including no listing', async () => {
    await correctListing('osm' as any, 'node/1', 'foursquare', null)
    expect(setProviderMatch).toHaveBeenCalledWith('osm', 'node/1', 'foursquare', { providerPlaceId: null, confirmed: true })
  })
})
