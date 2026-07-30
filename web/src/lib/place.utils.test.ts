/**
 * `getPlaceRouteFromExternalIds` replaced a store helper that assumed
 * `externalIds` looked like `{ osm: '123', osmType: 'node' }`. It never does —
 * the type is baked into the value (`{ osm: 'node/123' }`) — so that helper
 * produced dead routes and its tests only ever exercised the fiction.
 *
 * These pin the real shape, which both a bookmark card and a map dot route on.
 */

import { describe, it, expect } from 'vitest'
import { getPlaceRouteFromExternalIds } from './place.utils'

describe('getPlaceRouteFromExternalIds', () => {
  it('splits the OSM type out of the id value', () => {
    expect(getPlaceRouteFromExternalIds({ osm: 'node/123' })).toMatchObject({
      params: { type: 'node', id: '123' },
    })
  })

  it('handles ways and relations, not just nodes', () => {
    expect(getPlaceRouteFromExternalIds({ osm: 'way/456' })).toMatchObject({
      params: { type: 'way', id: '456' },
    })
    expect(getPlaceRouteFromExternalIds({ osm: 'relation/789' })).toMatchObject(
      { params: { type: 'relation', id: '789' } },
    )
  })

  it('prefers OSM when a place carries several provider ids', () => {
    expect(
      getPlaceRouteFromExternalIds({ google: 'abc', osm: 'node/123' }),
    ).toMatchObject({ params: { type: 'node', id: '123' } })
  })

  it('falls back to coordinates when there is no OSM id', () => {
    expect(
      getPlaceRouteFromExternalIds({ coords: '35.2271/-80.8431' }),
    ).toMatchObject({ params: { lat: '35.2271', lng: '-80.8431' } })
  })

  it('returns null when there is nothing to route to', () => {
    expect(getPlaceRouteFromExternalIds({})).toBeNull()
    expect(getPlaceRouteFromExternalIds(undefined)).toBeNull()
    expect(getPlaceRouteFromExternalIds(null)).toBeNull()
  })
})
