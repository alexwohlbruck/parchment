import { describe, expect, it } from 'vitest'
import { listingPlaceId, listingProviderName, listingTitle } from './listing-providers'

describe('listingProviderName', () => {
  it('uses the brand spelling', () => {
    expect(listingProviderName('opentable')).toBe('OpenTable')
  })

  it('reads an unknown provider as its key', () => {
    expect(listingProviderName('hotelbeds')).toBe('Hotelbeds')
  })
})

describe('listingPlaceId', () => {
  it('takes OSM elements', () => {
    expect(listingPlaceId({ osm: 'way/12', google: 'ChIJ' })).toBe('way/12')
  })

  it('has none for places without an OSM element', () => {
    expect(listingPlaceId({ google: 'ChIJ' })).toBeNull()
    expect(listingPlaceId({ osm: 'intersection/1' })).toBeNull()
  })
})

describe('listingTitle', () => {
  it("prefers the provider's name for the listing", () => {
    expect(listingTitle({ id: 'new-york-ny/carbone', name: 'Carbone' })).toBe('Carbone')
  })

  it('reads a slug id as words', () => {
    expect(listingTitle({ id: 'new-york-ny/carbone', name: null })).toBe('Carbone')
    expect(listingTitle({ id: 'r/gramercy-tavern-new-york', name: null })).toBe('Gramercy Tavern New York')
  })

  it('has none for an opaque id', () => {
    expect(listingTitle({ id: '4b5a1e2bf964a520', name: null })).toBeNull()
    expect(listingTitle({ id: 'rid/1234', name: null })).toBeNull()
    expect(listingTitle({ id: '98765', name: null })).toBeNull()
  })
})
