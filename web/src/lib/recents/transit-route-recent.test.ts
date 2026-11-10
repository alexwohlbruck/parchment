import { describe, test, expect } from 'vitest'
import { transitRouteToRecentPlace } from '@/lib/recents'
import { getPlaceRoute } from '@/lib/place/place-route'
import { AppRoute } from '@/router'
import type { RouteDetail } from '@/types/transit.types'

function route(overrides: Partial<RouteDetail> = {}): RouteDetail {
  return {
    feedId: 'f-nyc',
    routeId: 'Q',
    routeShortName: 'Q',
    routeLongName: 'Broadway Express',
    routeColor: 'FCCC0A',
    routeTextColor: '000000',
    routeType: 1,
    agencyName: 'MTA New York City Transit',
    stops: [],
    coordinates: null,
    relatedRouteIds: [],
    ...overrides,
  }
}

describe('transitRouteToRecentPlace', () => {
  test('shares the search hit id and routes back to the line', () => {
    const entry = transitRouteToRecentPlace(route({ routeId: 'MTA:Q' }))
    expect(entry.id).toBe('transit-route/f-nyc:MTA:Q')
    expect(getPlaceRoute(entry.id)).toEqual({
      name: AppRoute.TRANSIT_ROUTE,
      params: { feedId: 'f-nyc', routeId: 'MTA:Q' },
    })
  })

  test('wears the line bullet, titled by its long name', () => {
    const entry = transitRouteToRecentPlace(route())
    expect(entry.title).toBe('Broadway Express')
    expect(entry.subtitle).toBe('MTA New York City Transit')
    expect(entry.bullet).toEqual({ label: 'Q', color: 'FCCC0A', textColor: '000000' })
  })

  test('without a short name, falls back to a mode icon and no bullet', () => {
    const entry = transitRouteToRecentPlace(
      route({ routeShortName: null, routeLongName: 'Staten Island Ferry', routeType: 4 }),
    )
    expect(entry.bullet).toBeUndefined()
    expect(entry.icon).toBe('Ship')
    expect(entry.title).toBe('Staten Island Ferry')
  })
})
