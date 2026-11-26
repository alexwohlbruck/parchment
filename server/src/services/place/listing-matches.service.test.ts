import { beforeEach, describe, expect, mock, test } from 'bun:test'

const configured = new Set<string>()
mock.module('../integrations', () => ({
  integrationManager: {
    getConfiguredIntegrationForSource: (source: string, capability: string) =>
      configured.has(`${source}:${capability}`) ? { integrationId: source } : null,
  },
}))

const place = (source: string, id: string, name: string, lat: number, lng: number) => ({
  name: { value: name },
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

let stored: Record<string, { providerPlaceId: string | null; confirmed: boolean; label?: string | null }> = {}
const setProviderMatch = mock(async (..._args: unknown[]) => true)
mock.module('./provider-matches.service', () => ({ getProviderMatches: async () => stored, setProviderMatch }))

const { getPlaceListings, searchListingCandidates, correctListing } = await import('./listing-matches.service')

beforeEach(() => {
  configured.clear()
  stored = {}
  setProviderMatch.mockClear()
  lookupPlacesByNameAndLocation.mockReset()
})

describe('getPlaceListings', () => {
  test('lists configured auto-matched providers and any provider with a stored match', async () => {
    configured.add('foursquare:placeInfo').add('foursquare:search')
    stored = { opentable: { providerPlaceId: 'ot-1', confirmed: false } }

    const listings = await getPlaceListings('osm' as any, 'node/1')

    expect(listings).toEqual([
      { provider: 'foursquare', listing: null, confirmed: false, searchable: true },
      {
        provider: 'opentable',
        listing: { id: 'ot-1', name: null, address: null, distance: null },
        confirmed: false,
        searchable: false,
      },
    ])
  })
})

describe('stored display names', () => {
  test('names a listing that can’t be looked up from its stored label', async () => {
    stored = { google_hotels: { providerPlaceId: 'ChoIp8', confirmed: true, label: 'EVEN Hotel Brooklyn by IHG' } }
    const listings = await getPlaceListings('osm' as any, 'node/1')
    expect(listings.find((l) => l.provider === 'google_hotels')?.listing).toEqual({
      id: 'ChoIp8',
      name: 'EVEN Hotel Brooklyn by IHG',
      address: null,
      distance: null,
    })
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

describe('correctListing', () => {
  test('stores a person’s choice as confirmed, including no listing', async () => {
    await correctListing('osm' as any, 'node/1', 'foursquare', null)
    expect(setProviderMatch).toHaveBeenCalledWith('osm', 'node/1', 'foursquare', { providerPlaceId: null, confirmed: true })
  })
})
