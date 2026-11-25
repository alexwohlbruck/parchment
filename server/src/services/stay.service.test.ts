import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

let configured: { id: string }[] = []
const getStayRates = mock(async (request: { hotelId: string; checkout: string }) => ({
  provider: 'LiteAPI',
  hotelId: request.hotelId,
  rooms: [],
  bookingUrl: `https://stay.example.com/hotels/${request.hotelId}?checkout=${request.checkout}`,
}))
const findHotels = mock(async () => [
  { id: 'lp-ivey', name: 'The Ivey’s Hotel', lat: 35.2272, lng: -80.8431 },
  { id: 'lp-other', name: 'Dunhill Hotel', lat: 35.2275, lng: -80.8431 },
])

mock.module('./integrations', () => ({
  integrationManager: {
    getConfiguredIntegrationsByCapability: () => configured,
    getCachedIntegrationInstance: () => ({ capabilities: { hotelRates: { getStayRates, findHotels } } }),
  },
}))

let placeName = 'Ivey’s Hotel'
mock.module('./place.service', () => ({
  lookupPlaceById: async () => ({ name: { value: placeName }, geometry: { value: { center: { lat: 35.2271, lng: -80.8431 } } } }),
}))

let stored: Record<string, { providerPlaceId: string | null; confirmed: boolean }> = {}
const setProviderMatch = mock(async (..._args: unknown[]) => true)
mock.module('./place/provider-matches.service', () => ({
  getProviderMatches: async () => ({ ...stored }),
  setProviderMatch,
}))

const { getStayRates: stayRates, resetStayRatesForTests } = await import('./stay.service')

const stay = {
  checkin: '2026-11-25',
  checkout: '2026-11-26',
  adults: 2,
  currency: 'USD',
  guestNationality: 'US',
}
const rates = (s = stay) => stayRates('osm' as any, 'node/1', s)

beforeEach(() => {
  resetStayRatesForTests()
  getStayRates.mockClear()
  findHotels.mockClear()
  setProviderMatch.mockClear()
  configured = [{ id: 'liteapi' }]
  stored = {}
  placeName = 'Ivey’s Hotel'
})

afterEach(() => {
  delete process.env.LITEAPI_API_KEY
  delete process.env.LITEAPI_WHITELABEL_URL
})

describe('getStayRates', () => {
  test('is null when no provider is configured', async () => {
    configured = []
    expect(await rates()).toBeNull()
    expect(findHotels).not.toHaveBeenCalled()
  })

  test('prices the stored hotel without searching', async () => {
    stored = { liteapi: { providerPlaceId: 'lp-stored', confirmed: true } }
    expect((await rates())?.hotelId).toBe('lp-stored')
    expect(findHotels).not.toHaveBeenCalled()
  })

  test('never searches a place stored as not listed', async () => {
    stored = { liteapi: { providerPlaceId: null, confirmed: false } }
    expect(await rates()).toBeNull()
    expect(findHotels).not.toHaveBeenCalled()
    expect(getStayRates).not.toHaveBeenCalled()
  })

  test('matches the hotel the first time and stores it unconfirmed', async () => {
    expect((await rates())?.hotelId).toBe('lp-ivey')
    expect(findHotels).toHaveBeenCalledWith({ lat: 35.2271, lng: -80.8431 }, 1000)
    expect(setProviderMatch).toHaveBeenCalledWith('osm', 'node/1', 'liteapi', { providerPlaceId: 'lp-ivey', confirmed: false })
  })

  test('stores a miss as null, so a person can still correct it', async () => {
    placeName = 'Pod Times Square'
    expect(await rates()).toBeNull()
    expect(setProviderMatch).toHaveBeenCalledWith('osm', 'node/1', 'liteapi', { providerPlaceId: null, confirmed: false })
  })

  test('still prices a match the store failed to save', async () => {
    setProviderMatch.mockImplementationOnce(async () => {
      throw new Error('barrelman down')
    })
    expect((await rates())?.hotelId).toBe('lp-ivey')
  })

  test('matches once for requests made at the same time', async () => {
    await Promise.all([rates(), rates({ ...stay, checkout: '2026-11-27' })])
    expect(findHotels).toHaveBeenCalledTimes(1)
  })

  test('serves a repeat of the same stay from cache, and prices other dates afresh', async () => {
    stored = { liteapi: { providerPlaceId: 'lp-stored', confirmed: false } }
    await rates()
    await rates({ ...stay })
    expect(getStayRates).toHaveBeenCalledTimes(1)
    const other = await rates({ ...stay, checkout: '2026-11-27' })
    expect(getStayRates).toHaveBeenCalledTimes(2)
    expect(other?.bookingUrl).toContain('checkout=2026-11-27')
  })

  test('needs both env vars before it falls back to them', async () => {
    configured = []
    process.env.LITEAPI_API_KEY = 'sand_env'
    expect(await rates()).toBeNull()
  })
})
