import { describe, it, expect } from 'vitest'
import { getPlaceRoute, getTransitStopRoute } from './place.utils'
import { AppRoute } from '@/router'

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
