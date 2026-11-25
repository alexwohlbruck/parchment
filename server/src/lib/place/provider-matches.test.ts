import { describe, test, expect } from 'bun:test'
import { SOURCE } from '../constants'
import { matchedProviderIds, planMatchUpdate } from './provider-matches'

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
        { google: 'ChIJ1', foursquare: 'old' },
        { google: 'ChIJ1', foursquare: 'new' },
        [],
      ),
    ).toEqual({ upserts: { foursquare: 'new' }, removals: [] })
  })

  test('drops a stale id that the fallback search did not find again', () => {
    expect(planMatchUpdate({ google: 'gone' }, {}, [SOURCE.GOOGLE])).toEqual({
      upserts: {},
      removals: [SOURCE.GOOGLE],
    })
  })

  test('replaces a stale id with the one the fallback search found', () => {
    expect(
      planMatchUpdate({ google: 'gone' }, { google: 'ChIJ2' }, [SOURCE.GOOGLE]),
    ).toEqual({ upserts: { google: 'ChIJ2' }, removals: [] })
  })
})
