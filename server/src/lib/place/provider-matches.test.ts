import { describe, test, expect } from 'bun:test'
import { SOURCE } from '../constants'
import {
  clearedProviders,
  matchedProviderIds,
  matchStoreRef,
  planMatchUpdate,
  storedListingIds,
} from './provider-matches'

const auto = (providerPlaceId: string) => ({ providerPlaceId, confirmed: false })

describe('matchedProviderIds', () => {
  test('picks up provider ids gained during enrichment', () => {
    expect(
      matchedProviderIds(
        SOURCE.OSM,
        { osm: 'node/1' },
        { osm: 'node/1', google: 'ChIJ1', foursquare: 'fsq1', wikidata: 'Q1' },
      ),
    ).toEqual({ google: 'ChIJ1', foursquare: 'fsq1' })
  })

  test('ignores ids the place already had from its own data', () => {
    expect(
      matchedProviderIds(SOURCE.OSM, { google: 'ChIJ1' }, { google: 'ChIJ1' }),
    ).toEqual({})
  })

  test('never stores a match from a provider to itself', () => {
    expect(
      matchedProviderIds(SOURCE.GOOGLE, {}, { google: 'ChIJ1', foursquare: 'fsq1' }),
    ).toEqual({ foursquare: 'fsq1' })
  })
})

describe('planMatchUpdate', () => {
  test('writes new and changed ids, skips unchanged ones', () => {
    expect(
      planMatchUpdate(
        { google: auto('ChIJ1'), foursquare: auto('old') },
        { google: 'ChIJ1', foursquare: 'new' },
        [],
      ),
    ).toEqual({ upserts: { foursquare: 'new' }, removals: [] })
  })

  test('drops a stale id that the fallback search did not find again', () => {
    expect(planMatchUpdate({ google: auto('gone') }, {}, [SOURCE.GOOGLE])).toEqual({
      upserts: {},
      removals: [SOURCE.GOOGLE],
    })
  })

  test('replaces a stale id with the one the fallback search found', () => {
    expect(
      planMatchUpdate({ google: auto('gone') }, { google: 'ChIJ2' }, [SOURCE.GOOGLE]),
    ).toEqual({ upserts: { google: 'ChIJ2' }, removals: [] })
  })

  test('leaves a confirmed match alone while it still resolves', () => {
    expect(
      planMatchUpdate({ google: { providerPlaceId: 'chosen', confirmed: true } }, { google: 'other' }, []),
    ).toEqual({ upserts: {}, removals: [] })
  })

  test('replaces a confirmed match once its listing is gone', () => {
    expect(
      planMatchUpdate({ google: { providerPlaceId: 'chosen', confirmed: true } }, { google: 'other' }, [SOURCE.GOOGLE]),
    ).toEqual({ upserts: { google: 'other' }, removals: [] })
  })
})

describe('stored matches', () => {
  const stored = {
    google: auto('ChIJ1'),
    foursquare: { providerPlaceId: null, confirmed: true },
    opentable: auto('ot-1'),
  }

  test('only auto-matched listings are fetched directly', () => {
    expect(storedListingIds(stored)).toEqual({ google: 'ChIJ1' })
  })

  test('a confirmed null means no listing, for any provider', () => {
    expect(clearedProviders({ ...stored, resy: { providerPlaceId: null, confirmed: true } })).toEqual(['foursquare', 'resy'])
  })
})

describe('matchStoreRef', () => {
  test('keys OSM elements by type and id', () => {
    expect(matchStoreRef(SOURCE.OSM, 'way/42')).toEqual({ osmType: 'way', osmId: '42' })
  })

  test('has no key for other sources or synthetic ids', () => {
    expect(matchStoreRef(SOURCE.GOOGLE, 'node/1')).toBeNull()
    expect(matchStoreRef(SOURCE.OSM, 'intersection/1')).toBeNull()
    expect(matchStoreRef(SOURCE.OSM, 'node/abc')).toBeNull()
  })
})
