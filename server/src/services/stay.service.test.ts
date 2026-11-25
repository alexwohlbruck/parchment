import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

let configured: { id: string }[] = []
const getStayRates = mock(async (request: { hotelId: string; checkout: string }) => ({
  provider: 'LiteAPI',
  hotelId: 'lp1',
  rooms: [],
  bookingUrl: `https://stay.example.com/hotels/lp1?checkout=${request.checkout}`,
}))

mock.module('./integrations', () => ({
  integrationManager: {
    getConfiguredIntegrationsByCapability: () => configured,
    getCachedIntegrationInstance: () => ({ capabilities: { hotelRates: { getStayRates } } }),
  },
}))

const { getStayRates: stayRates, resetStayRatesForTests, setVenueIdLookup } = await import('./stay.service')

const place = { source: 'osm', id: 'node/1' }
const stay = {
  checkin: '2026-11-25',
  checkout: '2026-11-26',
  adults: 2,
  currency: 'USD',
  guestNationality: 'US',
}

beforeEach(() => {
  resetStayRatesForTests()
  getStayRates.mockClear()
  configured = [{ id: 'liteapi' }]
  setVenueIdLookup(async () => 'lp1')
})

afterEach(() => {
  delete process.env.LITEAPI_API_KEY
  delete process.env.LITEAPI_WHITELABEL_URL
})

describe('getStayRates', () => {
  test('is null when no provider is configured', async () => {
    configured = []
    expect(await stayRates(place, stay)).toBeNull()
  })

  test('is null when the place has no matched listing', async () => {
    setVenueIdLookup(async () => null)
    expect(await stayRates(place, stay)).toBeNull()
    expect(getStayRates).not.toHaveBeenCalled()
  })

  test('asks the match store for the LiteAPI venue of that place', async () => {
    const lookup = mock(async () => 'lp1')
    setVenueIdLookup(lookup)
    await stayRates(place, stay)
    expect(lookup).toHaveBeenCalledWith(place, 'liteapi')
    expect(getStayRates.mock.calls[0][0]).toMatchObject({ hotelId: 'lp1' })
  })

  test('serves a repeat of the same stay from cache', async () => {
    await stayRates(place, stay)
    await stayRates(place, { ...stay })
    expect(getStayRates).toHaveBeenCalledTimes(1)
  })

  test('prices other dates afresh', async () => {
    await stayRates(place, stay)
    const other = await stayRates(place, { ...stay, checkout: '2026-11-27' })
    expect(getStayRates).toHaveBeenCalledTimes(2)
    expect(other?.bookingUrl).toContain('checkout=2026-11-27')
  })

  test('needs both env vars before it falls back to them', async () => {
    configured = []
    process.env.LITEAPI_API_KEY = 'sand_env'
    expect(await stayRates(place, stay)).toBeNull()
  })
})
