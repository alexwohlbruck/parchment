import { describe, test, expect } from 'vitest'
import { isSamePlace } from './external-ids'

describe('isSamePlace', () => {
  test('matches on any shared provider id', () => {
    expect(
      isSamePlace({ osm: 'node/1', foursquare: 'a' }, { foursquare: 'a' }),
    ).toBe(true)
  })

  test('a provider both have, with different ids, is a different place', () => {
    expect(isSamePlace({ osm: 'node/1' }, { osm: 'node/2' })).toBe(false)
  })

  test('no providers in common never matches', () => {
    expect(isSamePlace({ osm: 'node/1' }, { foursquare: 'node/1' })).toBe(false)
  })
})
