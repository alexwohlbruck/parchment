import { describe, it, expect } from 'vitest'
import {
  getPlaceRoute,
  getPlaceRouteFromExternalIds,
  getTransitStopRoute,
} from '@/lib/place/place-route'
import { AppRoute } from '@/router'

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

  it('routes a geocoder address to the pelias provider view', () => {
    // Barrelman fronts Pelias, so a reverse-geocoded street address arrives
    // with only a `pelias` id. Routing it by name instead produced
    // `?source=osm&id=1415 South Church Street`, which the backend rejects as a
    // malformed OSM id.
    expect(
      getPlaceRouteFromExternalIds({
        pelias: 'openaddresses:address:us/nc/mecklenburg:9944f712',
      }),
    ).toMatchObject({
      params: {
        provider: 'pelias',
        placeId: 'openaddresses:address:us/nc/mecklenburg:9944f712',
      },
    })
  })

  it('keeps the whole gid when the id itself contains slashes', () => {
    const route: any = getPlaceRouteFromExternalIds({
      pelias: 'openaddresses:address:us/nc/mecklenburg:9944f712',
    })
    expect(route.params.placeId).toContain('us/nc/mecklenburg')
  })

  it('returns null when there is nothing to route to', () => {
    expect(getPlaceRouteFromExternalIds({})).toBeNull()
    expect(getPlaceRouteFromExternalIds(undefined)).toBeNull()
    expect(getPlaceRouteFromExternalIds(null)).toBeNull()
  })
})

describe('getPlaceRoute — transit ids', () => {
  it('resolves a GTFS line id to the transit route detail view', () => {
    expect(getPlaceRoute('transit-route/5:7')).toEqual({
      name: AppRoute.TRANSIT_ROUTE,
      params: { feedId: '5', routeId: '7' },
    })
  })

  it('splits on the first colon only — route ids may contain colons', () => {
    expect(getPlaceRoute('transit-route/mta:A:express')).toEqual({
      name: AppRoute.TRANSIT_ROUTE,
      params: { feedId: 'mta', routeId: 'A:express' },
    })
  })

  it('still resolves OSM ids the same way', () => {
    expect(getPlaceRoute('osm/node/123')).toEqual({
      name: AppRoute.PLACE,
      params: { type: 'node', id: '123' },
    })
  })
})

describe('getTransitStopRoute', () => {
  it('routes to the location place view with the transit widget expanded', () => {
    expect(getTransitStopRoute('Grand Central', 40.75, -73.98)).toEqual({
      name: AppRoute.PLACE_LOCATION,
      params: { name: 'Grand Central', lat: '40.75', lng: '-73.98' },
      query: { complex: '1' },
    })
  })

  it('never emits an empty name path segment', () => {
    const route = getTransitStopRoute('', 1, 2) as { params: { name: string } }
    expect(route.params.name).toBe('Station')
  })
})
