import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import type { StayOffer } from '../types/integration.types'

const offer = (seller: string, featured = false): StayOffer => ({
  seller,
  logo: null,
  official: false,
  featured,
  bookHere: false,
  nightly: { amount: 200, currency: 'USD' },
  total: { amount: 230, currency: 'USD' },
  freeCancellation: false,
  url: `https://${seller.toLowerCase()}.example/hotel`,
})

const ivey = { id: 'tok-ivey', name: 'The Ivey’s Hotel', lat: 35.2272, lng: -80.8431 }
const searchHotels = mock(async (..._args: unknown[]): Promise<any> => ({
  candidates: [ivey, { id: 'tok-other', name: 'Dunhill Hotel', lat: 35.2275, lng: -80.8431 }],
}))
const getOffers = mock(async (..._args: unknown[]) => [offer('Expedia.com', true), offer('Booking.com')])

const getStayRates = mock(async (request: { hotelId: string }) => ({
  provider: 'LiteAPI',
  hotelId: request.hotelId,
  rooms: [
    {
      offerId: 'o1',
      name: 'King',
      total: { amount: 300, currency: 'USD' },
      payAtProperty: null,
      board: null,
      freeCancellationUntil: '2026-11-24T23:00:00.000Z',
      bookingUrl: 'https://stay.example.com/booking?offerId=o1',
    },
  ],
  bookingUrl: `https://stay.example.com/hotels/${request.hotelId}`,
}))
const findHotels = mock(async () => [{ id: 'lp-ivey', name: 'Ivey’s Hotel', lat: 35.2271, lng: -80.8431 }])

let configured: string[] = []
mock.module('./integrations', () => ({
  integrationManager: {
    getConfiguredIntegrationsByCapability: (capability: string) => configured.filter((c) => c === capability).map((id) => ({ id })),
    getCachedIntegrationInstance: () => ({
      capabilities: { hotelPrices: { searchHotels, getOffers }, hotelRates: { getStayRates, findHotels } },
    }),
  },
}))

let placeName = 'Ivey’s Hotel'
mock.module('./place.service', () => ({
  lookupPlaceById: async () => ({
    name: { value: placeName },
    address: { value: { locality: 'Charlotte' } },
    geometry: { value: { center: { lat: 35.2271, lng: -80.8431 } } },
  }),
}))

let stored: Record<string, { providerPlaceId: string | null; confirmed: boolean }> = {}
const setProviderMatch = mock(async (..._args: unknown[]) => true)
mock.module('./place/provider-matches.service', () => ({
  getProviderMatches: async () => ({ ...stored }),
  setProviderMatch,
}))

const { getStayOffers, resetStayOffersForTests } = await import('./stay.service')

const stay = { checkin: '2026-11-25', checkout: '2026-11-27', adults: 2, currency: 'USD', guestNationality: 'US' }
const offers = (s = stay) => getStayOffers('osm' as any, 'node/1', s)
const sellers = async (s = stay) => (await offers(s))?.offers.map((o) => o.seller)

beforeEach(() => {
  resetStayOffersForTests()
  for (const m of [searchHotels, getOffers, getStayRates, findHotels, setProviderMatch]) m.mockClear()
  configured = ['hotelPrices']
  stored = {}
  placeName = 'Ivey’s Hotel'
})

afterEach(() => {
  delete process.env.SERPAPI_API_KEY
  delete process.env.STAY_PRICE_FIXTURES
})

describe('getStayOffers', () => {
  test('is null with no hotel price source configured', async () => {
    configured = []
    expect(await offers()).toBeNull()
  })

  test('matches Google Hotels once by name and stores the property token unconfirmed', async () => {
    expect(await sellers()).toEqual(['Expedia.com', 'Booking.com'])
    expect(searchHotels.mock.calls[0][0]).toBe('Ivey’s Hotel, Charlotte')
    expect(setProviderMatch).toHaveBeenCalledWith('osm', 'node/1', 'google_hotels', { providerPlaceId: 'tok-ivey', confirmed: false })
    expect(getOffers).toHaveBeenCalledWith('tok-ivey', stay)
  })

  test('uses prices Google returned with the match instead of a second search', async () => {
    searchHotels.mockImplementationOnce(async () => ({
      candidates: [ivey],
      property: { candidate: ivey, offers: [offer('Official', true)] },
    }))
    expect(await sellers()).toEqual(['Official'])
    expect(getOffers).not.toHaveBeenCalled()
  })

  test('spends one search per later check, using the stored token', async () => {
    stored = { google_hotels: { providerPlaceId: 'tok-stored', confirmed: true } }
    await offers()
    expect(searchHotels).not.toHaveBeenCalled()
    expect(getOffers).toHaveBeenCalledWith('tok-stored', stay)
  })

  test('never searches a hotel stored as not listed', async () => {
    stored = { google_hotels: { providerPlaceId: null, confirmed: false } }
    expect(await offers()).toBeNull()
    expect(searchHotels).not.toHaveBeenCalled()
  })

  test('stores a miss as null', async () => {
    placeName = 'Pod Times Square'
    expect(await offers()).toBeNull()
    expect(setProviderMatch).toHaveBeenCalledWith('osm', 'node/1', 'google_hotels', { providerPlaceId: null, confirmed: false })
  })

  test('caches a stay for 30 minutes, and prices other dates afresh', async () => {
    stored = { google_hotels: { providerPlaceId: 'tok', confirmed: false } }
    await offers()
    await offers({ ...stay })
    expect(getOffers).toHaveBeenCalledTimes(1)
    await offers({ ...stay, checkout: '2026-11-28' })
    expect(getOffers).toHaveBeenCalledTimes(2)
  })

  test('puts our booking partner first, priced per night', async () => {
    configured = ['hotelPrices', 'hotelRates']
    const result = await offers()
    expect(result?.offers.map((o) => o.seller)).toEqual(['LiteAPI', 'Expedia.com', 'Booking.com'])
    expect(result?.offers[0]).toMatchObject({
      bookHere: true,
      nightly: { amount: 150, currency: 'USD' },
      total: { amount: 300, currency: 'USD' },
      freeCancellation: true,
      url: 'https://stay.example.com/hotels/lp-ivey',
    })
    expect(setProviderMatch).toHaveBeenCalledWith('osm', 'node/1', 'liteapi', { providerPlaceId: 'lp-ivey', confirmed: false })
  })

  test('matches LiteAPI by name first, then among every hotel nearby', async () => {
    configured = ['hotelRates']
    findHotels.mockImplementationOnce(async () => [])
    expect(await sellers()).toEqual(['LiteAPI'])
    expect(findHotels.mock.calls.map((c: any[]) => c[2])).toEqual(['Ivey’s Hotel', undefined])
  })

  test('works with the booking partner alone', async () => {
    configured = ['hotelRates']
    expect(await sellers()).toEqual(['LiteAPI'])
  })

  test('keeps one source when the other fails, without caching the gap', async () => {
    configured = ['hotelPrices', 'hotelRates']
    getOffers.mockImplementationOnce(async () => {
      throw new Error('quota')
    })
    expect(await sellers()).toEqual(['LiteAPI'])
    expect(await sellers()).toEqual(['LiteAPI', 'Expedia.com', 'Booking.com'])
  })

  test('fails when every source fails, so the client keeps its links', async () => {
    getOffers.mockImplementationOnce(async () => {
      throw new Error('down')
    })
    await expect(offers()).rejects.toThrow('Hotel prices unavailable')
  })

  test('serves recorded prices only in development with the fixture flag', async () => {
    configured = []
    stored = { google_hotels: { providerPlaceId: 'any', confirmed: true } }
    process.env.STAY_PRICE_FIXTURES = '1'
    const env = process.env.NODE_ENV
    try {
      process.env.NODE_ENV = 'production'
      expect(await offers()).toBeNull()
      process.env.NODE_ENV = 'development'
      resetStayOffersForTests()
      expect((await offers())?.offers[0].seller).toBe('EVEN Hotel Brooklyn by IHG')
    } finally {
      process.env.NODE_ENV = env
    }
  })

  test('falls back to SERPAPI_API_KEY', async () => {
    configured = []
    process.env.SERPAPI_API_KEY = 'serp_env'
    const realFetch = globalThis.fetch
    globalThis.fetch = mock(async () => new Response(JSON.stringify({ error: "Google Hotels hasn't returned any results for this query." }))) as any
    try {
      expect(await offers()).toBeNull()
      expect((globalThis.fetch as any).mock.calls[0][0]).toContain('api_key=serp_env')
    } finally {
      globalThis.fetch = realFetch
    }
  })
})
