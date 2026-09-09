/**
 * Unit tests for the brand service.
 *
 * The filter construction is the subtle part: OSM tag values are
 * case-sensitive, so a brand identified only by name must be queried with its
 * ORIGINAL casing — the lowercased `name:` key would match nothing. QID-shaped
 * keys take the wikidata path instead.
 *
 * The header also prefers catalog-resolved logo/description over a live
 * Wikidata fetch, so a fully-populated catalog row does no network at all.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'

let configuredIntegrations: any[] = []
let instance: any = null

const getConfiguredIntegrationsByCapability = mock(
  (_capability: string) => configuredIntegrations,
)
const getCachedIntegrationInstance = mock(() => instance)

mock.module('./integrations', () => ({
  integrationManager: {
    getConfiguredIntegrationsByCapability,
    getCachedIntegrationInstance,
  },
}))

const fetchWikidataBrandMeta = mock(async (_qid: string, _lang: string) => ({
  logoUrl: 'https://wikidata.test/logo.png',
  description: 'A coffee chain',
}))
mock.module('./wikidata.service', () => ({ fetchWikidataBrandMeta }))

const { getBrandSuggestions, getBrandMeta, searchByBrand } = await import(
  './brand.service'
)

const getBrands = mock(async (_q: string, _limit: number) => [
  { brandKey: 'Q38076', name: 'Starbucks' },
])
const getBrand = mock(async (_key: string) => ({
  brandKey: 'Q38076',
  name: 'Starbucks',
  wikidata: 'Q38076',
  locationCount: 1200,
  category: 'cafe',
}) as any)
const searchByBrandCap = mock(async (_filter: any, _opts: any) => [
  { id: 'osm/node/1' },
])

beforeEach(() => {
  configuredIntegrations = [{ integrationId: 'barrelman' }]
  instance = {
    capabilities: {
      brandCatalog: { getBrands, getBrand, searchByBrand: searchByBrandCap },
    },
  }
  getBrands.mockClear()
  getBrands.mockImplementation(async () => [
    { brandKey: 'Q38076', name: 'Starbucks' },
  ])
  getBrand.mockClear()
  getBrand.mockImplementation(async () => ({
    brandKey: 'Q38076',
    name: 'Starbucks',
    wikidata: 'Q38076',
    locationCount: 1200,
    category: 'cafe',
  }))
  searchByBrandCap.mockClear()
  searchByBrandCap.mockImplementation(async () => [{ id: 'osm/node/1' }])
  fetchWikidataBrandMeta.mockClear()
  fetchWikidataBrandMeta.mockImplementation(async () => ({
    logoUrl: 'https://wikidata.test/logo.png',
    description: 'A coffee chain',
  }))
})

describe('getBrandSuggestions', () => {
  test('returns catalog suggestions', async () => {
    expect(await getBrandSuggestions('star')).toHaveLength(1)
    expect(getBrands).toHaveBeenCalledWith('star', 5)
  })

  test('honours an explicit limit', async () => {
    await getBrandSuggestions('star', 10)

    expect(getBrands.mock.calls[0][1]).toBe(10)
  })

  test('returns empty when no brand catalog is configured', async () => {
    configuredIntegrations = []

    expect(await getBrandSuggestions('star')).toEqual([])
  })

  test('swallows a catalog failure — suggestions are best-effort', async () => {
    getBrands.mockRejectedValueOnce(new Error('barrelman down'))

    expect(await getBrandSuggestions('star')).toEqual([])
  })
})

describe('getBrandMeta', () => {
  test('returns the catalog row', async () => {
    expect((await getBrandMeta('Q38076'))!.name).toBe('Starbucks')
  })

  test('returns null with no catalog configured', async () => {
    configuredIntegrations = []

    expect(await getBrandMeta('Q38076')).toBeNull()
  })

  test('returns null when the catalog throws', async () => {
    getBrand.mockRejectedValueOnce(new Error('boom'))

    expect(await getBrandMeta('Q38076')).toBeNull()
  })

  test('returns null when the instance lacks the capability', async () => {
    instance = { capabilities: {} }

    expect(await getBrandMeta('Q38076')).toBeNull()
  })
})

describe('searchByBrand — filter construction', () => {
  test('a QID key queries by wikidata', async () => {
    await searchByBrand('Q38076')

    expect(searchByBrandCap.mock.calls[0][0]).toEqual({ wikidata: 'Q38076' })
  })

  test('a name: key uses the client-supplied original casing', async () => {
    // OSM tag values are case-sensitive; "joe's pizza" would match nothing.
    getBrand.mockResolvedValueOnce(null)

    await searchByBrand("name:joe's pizza", { brandName: "Joe's Pizza" })

    expect(searchByBrandCap.mock.calls[0][0]).toEqual({ name: "Joe's Pizza" })
  })

  test('falls back to the catalog’s canonical name', async () => {
    getBrand.mockResolvedValueOnce({ name: "Joe's Pizza", wikidata: null } as any)

    await searchByBrand("name:joe's pizza")

    expect(searchByBrandCap.mock.calls[0][0]).toEqual({ name: "Joe's Pizza" })
  })

  test('strips the name: prefix as a last resort', async () => {
    getBrand.mockResolvedValueOnce(null)

    await searchByBrand('name:corner shop')

    expect(searchByBrandCap.mock.calls[0][0]).toEqual({ name: 'corner shop' })
  })

  test('a bare name key is used as-is', async () => {
    getBrand.mockResolvedValueOnce(null)

    await searchByBrand('Corner Shop')

    expect(searchByBrandCap.mock.calls[0][0]).toEqual({ name: 'Corner Shop' })
  })

  test('the client label wins over the catalog name', async () => {
    getBrand.mockResolvedValueOnce({ name: 'Catalog Name', wikidata: null } as any)

    await searchByBrand('name:whatever', { brandName: 'Client Label' })

    expect(searchByBrandCap.mock.calls[0][0]).toEqual({ name: 'Client Label' })
  })
})

describe('searchByBrand — header', () => {
  test('builds the header from the catalog row', async () => {
    const { brand } = await searchByBrand('Q38076')

    expect(brand).toMatchObject({
      brandKey: 'Q38076',
      name: 'Starbucks',
      wikidata: 'Q38076',
      locationCount: 1200,
      category: 'cafe',
    })
  })

  test('derives the QID from the key when the catalog has none', async () => {
    getBrand.mockResolvedValueOnce(null)

    const { brand } = await searchByBrand('Q38076')

    expect(brand.wikidata).toBe('Q38076')
  })

  test('reports a null QID for a name-only brand', async () => {
    getBrand.mockResolvedValueOnce(null)

    const { brand } = await searchByBrand('name:corner shop')

    expect(brand.wikidata).toBeNull()
    expect(fetchWikidataBrandMeta).not.toHaveBeenCalled()
  })

  test('falls back to the client label then the key for the name', async () => {
    getBrand.mockResolvedValueOnce(null)

    const withLabel = await searchByBrand('Q1', { brandName: 'Label' })
    expect(withLabel.brand.name).toBe('Label')

    getBrand.mockResolvedValueOnce(null)
    const bare = await searchByBrand('Q2')
    expect(bare.brand.name).toBe('Q2')
  })

  test('nulls counts and category when the catalog has no row', async () => {
    getBrand.mockResolvedValueOnce(null)

    const { brand } = await searchByBrand('Q38076')

    expect(brand.locationCount).toBeNull()
    expect(brand.category).toBeNull()
  })
})

describe('searchByBrand — Wikidata enrichment', () => {
  test('skips the network when the catalog already has logo and description', async () => {
    getBrand.mockResolvedValueOnce({
      name: 'Starbucks',
      wikidata: 'Q38076',
      logoUrl: 'https://catalog.test/logo.png',
      description: 'From the catalog',
    } as any)

    const { brand } = await searchByBrand('Q38076')

    expect(fetchWikidataBrandMeta).not.toHaveBeenCalled()
    expect(brand.logoUrl).toBe('https://catalog.test/logo.png')
    expect(brand.description).toBe('From the catalog')
  })

  test('fetches from Wikidata when the catalog has neither', async () => {
    const { brand } = await searchByBrand('Q38076')

    expect(fetchWikidataBrandMeta).toHaveBeenCalledWith('Q38076', 'en')
    expect(brand.logoUrl).toBe('https://wikidata.test/logo.png')
    expect(brand.description).toBe('A coffee chain')
  })

  test('fills only the missing half', async () => {
    getBrand.mockResolvedValueOnce({
      name: 'Starbucks',
      wikidata: 'Q38076',
      logoUrl: 'https://catalog.test/logo.png',
    } as any)

    const { brand } = await searchByBrand('Q38076')

    expect(brand.logoUrl).toBe('https://catalog.test/logo.png')
    expect(brand.description).toBe('A coffee chain')
  })

  test('passes the base language, not the full locale', async () => {
    await searchByBrand('Q38076', { language: 'es-ES' })

    expect(fetchWikidataBrandMeta.mock.calls[0][1]).toBe('es')
  })

  test('tolerates Wikidata returning nothing', async () => {
    fetchWikidataBrandMeta.mockResolvedValueOnce({
      logoUrl: null,
      description: null,
    } as any)

    const { brand } = await searchByBrand('Q38076')

    expect(brand.logoUrl).toBeUndefined()
    expect(brand.description).toBeUndefined()
  })
})

describe('searchByBrand — results', () => {
  test('passes the viewport and widening hints through', async () => {
    await searchByBrand('Q38076', {
      bounds: { north: 36, south: 35, east: -80, west: -81 } as any,
      lat: 35.2,
      lng: -80.8,
      minResults: 5,
      maxResults: 50,
    })

    expect(searchByBrandCap.mock.calls[0][1]).toMatchObject({
      lat: 35.2,
      lng: -80.8,
      minResults: 5,
      limit: 50,
    })
  })

  test('returns the header with no results when the catalog is absent', async () => {
    configuredIntegrations = []

    const { brand, results } = await searchByBrand('Q38076')

    expect(results).toEqual([])
    expect(brand.brandKey).toBe('Q38076')
  })

  test('returns the catalog results on success', async () => {
    const { results } = await searchByBrand('Q38076')

    expect(results).toEqual([{ id: 'osm/node/1' }])
  })
})
