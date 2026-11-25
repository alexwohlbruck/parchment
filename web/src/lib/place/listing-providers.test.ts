import { describe, expect, it } from 'vitest'
import { listingPlaceId, listingProviderName } from './listing-providers'

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
