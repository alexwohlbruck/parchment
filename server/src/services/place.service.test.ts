/**
 * Unit tests for place lookup and enrichment.
 *
 * The enrichment pipeline is the interesting part. `lookupEnrichedPlaceById`
 * composes several providers, and two rules are load-bearing:
 *
 *   - third-party blending is PREMIUM-only, and is additionally skipped for a
 *     Transitland transit stop even on premium — a Google/Foursquare match on
 *     a station name would otherwise override authoritative transit data;
 *   - the third-party search excludes the source we already queried, so a
 *     provider can't "confirm" its own result and inflate the merge score.
 *
 * Enrichment runs against deep clones in parallel, so a slow or failing
 * provider can't mutate the place another one is reading.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { SOURCE } from '../lib/constants'

/** Integration records returned per (source, capability) lookup. */
let placeInfoRecord: any = { integrationId: 'barrelman' }
let instance: any = null

const getConfiguredIntegrationForSource = mock(
  (_source: string, _capability: string) => placeInfoRecord,
)
const getCachedIntegrationInstance = mock(() => instance)
const getConfiguredIntegrationsByCapability = mock(() => [] as any[])

mock.module('./integrations', () => ({
  integrationManager: {
    getConfiguredIntegrationForSource,
    getCachedIntegrationInstance,
    getConfiguredIntegrationsByCapability,
    getConfiguredIntegrations: () => [],
  },
}))

for (const mod of [
  './integrations/foursquare-integration',
  './integrations/wikidata-integration',
  './integrations/wikipedia-integration',
  './integrations/wikimedia-integration',
]) {
  mock.module(mod, () => ({
    FoursquareIntegration: class {},
    WikidataIntegration: class {},
    WikipediaIntegration: class {},
    WikimediaIntegration: class {},
  }))
}

mock.module('./integrations/wiki-utils', () => ({
  dedupeWikiPhotos: (photos: unknown[]) => photos,
}))

const findBookmarkByExternalIds = mock(async () => null)
mock.module('./library/bookmarks.service', () => ({ findBookmarkByExternalIds }))

/** Merge is exercised by its own suite; here it just needs to combine. */
const mergePlaces = mock((primary: any, ...rest: any[]) =>
  Object.assign({}, primary, ...rest.filter(Boolean)),
)
const mergePlacesCollection = mock((places: any[]) => places)
mock.module('./merge.service', () => ({ mergePlaces, mergePlacesCollection }))

mock.module('../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
  logError: () => {},
  logWarn: () => {},
}))

const {
  lookupPlaceById,
  lookupPlaceByNameAndLocation,
  lookupEnrichedPlaceById,
} = await import('./place.service')

/**
 * Base fixture. `placeType` is always present because the enrichment path
 * dereferences `place.placeType.value` without guarding — a provider result
 * lacking it makes the whole lookup return null.
 */
const basePlace = (over: Partial<any> = {}) => ({
  id: 'osm/node/1',
  name: { value: 'Main St Station' },
  placeType: { value: 'Cafe' },
  geometry: { value: { center: { lat: 35.2, lng: -80.8 } } },
  amenities: {},
  externalIds: {},
  sources: [{ id: SOURCE.OSM }],
  ...over,
})

const getPlaceInfo = mock(async (_id: string, _opts?: unknown) => basePlace())
const searchPlaces = mock(async (..._args: unknown[]) => [] as any[])

beforeEach(() => {
  placeInfoRecord = { integrationId: 'barrelman' }
  instance = {
    integrationId: 'barrelman',
    capabilities: { placeInfo: { getPlaceInfo }, search: { searchPlaces } },
  }
  getPlaceInfo.mockClear()
  getPlaceInfo.mockImplementation(async () => basePlace())
  searchPlaces.mockClear()
  searchPlaces.mockImplementation(async () => [])
  getConfiguredIntegrationForSource.mockClear()
  getCachedIntegrationInstance.mockClear()
  getConfiguredIntegrationsByCapability.mockClear()
  getConfiguredIntegrationsByCapability.mockImplementation(() => [])
  mergePlaces.mockClear()
  findBookmarkByExternalIds.mockClear()
})

describe('lookupPlaceById', () => {
  test('delegates to the source’s place-info capability', async () => {
    const place = await lookupPlaceById(SOURCE.OSM as any, 'node/1')

    expect(place).toMatchObject({ id: 'osm/node/1' })
    expect(getPlaceInfo).toHaveBeenCalledWith('node/1', undefined)
  })

  test('passes the language option through', async () => {
    await lookupPlaceById(SOURCE.OSM as any, 'node/1', { language: 'es-ES' as any })

    expect(getPlaceInfo.mock.calls[0][1]).toEqual({ language: 'es-ES' })
  })

  test('returns null when no integration serves the source', async () => {
    placeInfoRecord = null

    expect(await lookupPlaceById(SOURCE.GOOGLE as any, 'g-1')).toBeNull()
  })

  test('returns null when the integration has no cached instance', async () => {
    instance = null

    expect(await lookupPlaceById(SOURCE.OSM as any, 'node/1')).toBeNull()
  })

  test('returns null when the instance lacks the capability', async () => {
    instance = { capabilities: {} }

    expect(await lookupPlaceById(SOURCE.OSM as any, 'node/1')).toBeNull()
  })

  test('returns null rather than throwing when the provider fails', async () => {
    getPlaceInfo.mockRejectedValueOnce(new Error('barrelman 500'))

    expect(await lookupPlaceById(SOURCE.OSM as any, 'node/1')).toBeNull()
  })

  test('returns null when the provider resolves to nothing', async () => {
    getPlaceInfo.mockResolvedValueOnce(null as any)

    expect(await lookupPlaceById(SOURCE.OSM as any, 'node/1')).toBeNull()
  })
})

describe('lookupPlaceByNameAndLocation', () => {
  test('returns null when no provider matches', async () => {
    getConfiguredIntegrationsByCapability.mockImplementation(() => [])

    expect(
      await lookupPlaceByNameAndLocation('Cafe', { lat: 35.2, lng: -80.8 }),
    ).toBeNull()
  })

  test('returns the top match when providers respond', async () => {
    getConfiguredIntegrationsByCapability.mockImplementation(() => [
      { integrationId: 'google' },
    ])
    searchPlaces.mockImplementation(async () => [basePlace({ id: 'g-1' })])
    mergePlacesCollection.mockImplementation((places: any[]) => places)

    const place = await lookupPlaceByNameAndLocation('Cafe', {
      lat: 35.2,
      lng: -80.8,
    })

    expect(place).toMatchObject({ id: 'g-1' })
  })

  test('returns null rather than throwing when a provider fails', async () => {
    getConfiguredIntegrationsByCapability.mockImplementation(() => {
      throw new Error('registry exploded')
    })

    expect(
      await lookupPlaceByNameAndLocation('Cafe', { lat: 35.2, lng: -80.8 }),
    ).toBeNull()
  })

  test('attaches bookmark info when a user id is supplied', async () => {
    getConfiguredIntegrationsByCapability.mockImplementation(() => [
      { integrationId: 'google' },
    ])
    searchPlaces.mockImplementation(async () => [basePlace({ id: 'g-1' })])

    await lookupPlaceByNameAndLocation(
      'Cafe',
      { lat: 35.2, lng: -80.8 },
      { userId: 'user-1' },
    )

    expect(findBookmarkByExternalIds).toHaveBeenCalled()
  })

  test('skips the bookmark lookup for an anonymous caller', async () => {
    getConfiguredIntegrationsByCapability.mockImplementation(() => [
      { integrationId: 'google' },
    ])
    searchPlaces.mockImplementation(async () => [basePlace({ id: 'g-1' })])

    await lookupPlaceByNameAndLocation('Cafe', { lat: 35.2, lng: -80.8 })

    expect(findBookmarkByExternalIds).not.toHaveBeenCalled()
  })
})

describe('lookupEnrichedPlaceById', () => {
  test('returns null when the base lookup finds nothing', async () => {
    getPlaceInfo.mockResolvedValueOnce(null as any)

    expect(await lookupEnrichedPlaceById(SOURCE.OSM as any, 'node/1')).toBeNull()
  })

  test('returns the enriched place on the happy path', async () => {
    const place = await lookupEnrichedPlaceById(SOURCE.OSM as any, 'node/1')

    expect(place).toBeTruthy()
    expect(getPlaceInfo).toHaveBeenCalled()
  })

  test('skips third-party blending for a non-premium caller', async () => {
    // Blending is a paid-tier feature; a free caller must not trigger the
    // extra provider fan-out.
    await lookupEnrichedPlaceById(SOURCE.OSM as any, 'node/1', {
      premiumData: false,
    })

    expect(searchPlaces).not.toHaveBeenCalled()
  })

  test('blends third-party data for a premium caller', async () => {
    getConfiguredIntegrationsByCapability.mockImplementation(() => [
      { integrationId: 'google' },
    ])

    await lookupEnrichedPlaceById(SOURCE.OSM as any, 'node/1', {
      premiumData: true,
    })

    expect(searchPlaces).toHaveBeenCalled()
  })

  test('never blends over a Transitland transit stop', async () => {
    // A Google match on a station name would override authoritative transit
    // data, so this is skipped even on premium.
    getPlaceInfo.mockResolvedValueOnce(
      basePlace({
        placeType: { value: 'station' },
        amenities: { public_transport: { value: 'station' } },
      }) as any,
    )
    getConfiguredIntegrationsByCapability.mockImplementation(() => [
      { integrationId: 'google' },
    ])

    await lookupEnrichedPlaceById(SOURCE.TRANSITLAND as any, 'tl-1', {
      premiumData: true,
    })

    expect(searchPlaces).not.toHaveBeenCalled()
  })

  test('still blends a transit stop that came from a non-Transitland source', async () => {
    getPlaceInfo.mockResolvedValueOnce(
      basePlace({
        placeType: { value: 'station' },
        amenities: { public_transport: { value: 'station' } },
      }) as any,
    )
    getConfiguredIntegrationsByCapability.mockImplementation(() => [
      { integrationId: 'google' },
    ])

    await lookupEnrichedPlaceById(SOURCE.OSM as any, 'node/1', {
      premiumData: true,
    })

    expect(searchPlaces).toHaveBeenCalled()
  })

  test('merges enrichment results rather than returning the base place', async () => {
    await lookupEnrichedPlaceById(SOURCE.OSM as any, 'node/1')

    // Wiki + address + Foursquare results are merged together.
    expect(mergePlaces).toHaveBeenCalled()
  })

  test('enriches from deep clones so providers cannot mutate each other', async () => {
    const base = basePlace()
    getPlaceInfo.mockResolvedValueOnce(base as any)

    await lookupEnrichedPlaceById(SOURCE.OSM as any, 'node/1')

    // Each enrichment receives its own object, never the shared base.
    const firstMergeArgs = mergePlaces.mock.calls.at(-1) as any[]
    for (const arg of firstMergeArgs) {
      if (arg) expect(arg).not.toBe(base)
    }
  })

  test('returns null rather than throwing when enrichment fails', async () => {
    mergePlaces.mockImplementation(() => {
      throw new Error('merge exploded')
    })

    expect(await lookupEnrichedPlaceById(SOURCE.OSM as any, 'node/1')).toBeNull()

    mergePlaces.mockImplementation((primary: any, ...rest: any[]) =>
      Object.assign({}, primary, ...rest.filter(Boolean)),
    )
  })
})
