/**
 * Tests for folding a route's alerts into per-stop serve/skip overrides.
 *
 * The anchor is the day that motivated this: a parade closing Eastern Pkwy,
 * with the MTA publishing "4 runs local" (MODIFIED_SERVICE naming each local
 * stop) and "2, 3, 4 skip Eastern Pkwy–Brooklyn Museum" (DETOUR naming stop
 * 238) side by side.
 */

import { describe, it, expect } from 'vitest'
import {
  alertServiceOverrides,
  alertStopSkips,
  filterSkippedDepartures,
} from './alert-service-overrides'
import type { ServiceAlert } from '@/types/transit.types'

const alert = (
  effect: string,
  entities: Array<{ routeId?: string; stopId?: string }>,
): ServiceAlert =>
  ({
    id: 'a',
    feedId: '5',
    cause: 'UNKNOWN_CAUSE',
    effect,
    severity: 'WARNING',
    header: '',
    activePeriods: [],
    informedEntities: entities,
  }) as unknown as ServiceAlert

describe('alertServiceOverrides', () => {
  it('reads MODIFIED_SERVICE as the stops the line now serves', () => {
    const { serves, skips } = alertServiceOverrides(
      [alert('MODIFIED_SERVICE', [
        { routeId: '4', stopId: '236' },
        { routeId: '4', stopId: '237' },
      ])],
      '4',
    )
    expect([...serves].sort()).toEqual(['236', '237'])
    expect(skips.size).toBe(0)
  })

  it('reads DETOUR and NO_SERVICE as the stops it does not', () => {
    const { serves, skips } = alertServiceOverrides(
      [
        alert('DETOUR', [{ routeId: '4', stopId: '238' }]),
        alert('NO_SERVICE', [{ routeId: '4', stopId: '640' }]),
      ],
      '4',
    )
    expect(serves.size).toBe(0)
    expect([...skips].sort()).toEqual(['238', '640'])
  })

  it('ignores entities about other routes', () => {
    // The skip alert names the 2, 3 and 4 at stop 238; asking about the 2
    // must not pick up the 4's local stops.
    const { serves, skips } = alertServiceOverrides(
      [
        alert('MODIFIED_SERVICE', [{ routeId: '4', stopId: '237' }]),
        alert('DETOUR', [
          { routeId: '2', stopId: '238' },
          { routeId: '4', stopId: '238' },
        ]),
      ],
      '2',
    )
    expect(serves.size).toBe(0)
    expect([...skips]).toEqual(['238'])
  })

  it('ignores entities that do not name a stop', () => {
    // "Delays on the 4" informs the route, not any stop — it says nothing
    // about the path.
    const { serves, skips } = alertServiceOverrides(
      [alert('MODIFIED_SERVICE', [{ routeId: '4' }])],
      '4',
    )
    expect(serves.size + skips.size).toBe(0)
  })

  it('ignores effects that carry no service claim', () => {
    const { serves, skips } = alertServiceOverrides(
      [alert('SIGNIFICANT_DELAYS', [{ routeId: '4', stopId: '237' }])],
      '4',
    )
    expect(serves.size + skips.size).toBe(0)
  })

  it('lets one day carry both: local stops added, one of them skipped', () => {
    const { serves, skips } = alertServiceOverrides(
      [
        alert('MODIFIED_SERVICE', [
          { routeId: '4', stopId: '236' },
          { routeId: '4', stopId: '237' },
          { routeId: '4', stopId: '238' },
        ]),
        alert('DETOUR', [{ routeId: '4', stopId: '238' }]),
      ],
      '4',
    )
    expect(serves.has('238')).toBe(true)
    expect(skips.has('238')).toBe(true) // the caller lets skip win
  })
})

describe('alertStopSkips', () => {
  it('collects every route the skip alert names at each stop', () => {
    // The Labor Day detour: one alert, three routes, one emptied station.
    const skips = alertStopSkips([
      alert('DETOUR', [
        { routeId: '2', stopId: '238' },
        { routeId: '3', stopId: '238' },
        { routeId: '4', stopId: '238' },
      ]),
    ])
    expect([...skips.get('238')!].sort()).toEqual(['2', '3', '4'])
  })

  it('keeps skips at different stops apart', () => {
    const skips = alertStopSkips([
      alert('NO_SERVICE', [
        { routeId: '4', stopId: '640' },
        { routeId: '4', stopId: '238' },
      ]),
    ])
    expect(skips.get('640')!.has('4')).toBe(true)
    expect(skips.get('238')!.has('4')).toBe(true)
    expect(skips.size).toBe(2)
  })

  it('ignores effects that add service and entities missing a pair', () => {
    const skips = alertStopSkips([
      alert('MODIFIED_SERVICE', [{ routeId: '4', stopId: '237' }]),
      alert('DETOUR', [{ routeId: '4' }, { stopId: '238' }]),
    ])
    expect(skips.size).toBe(0)
  })
})

describe('filterSkippedDepartures', () => {
  const HOUR = 3_600_000
  const iso = (ms: number) => new Date(ms).toISOString()
  const dep = (routeId: string, at: number) => ({
    route: { id: routeId },
    departureAt: iso(at),
  })
  // The parade: 2/3/4 skip stop 238 from an hour ago until an hour from now.
  const skip = {
    ...alert('DETOUR', [
      { routeId: '2', stopId: '238' },
      { routeId: '3', stopId: '238' },
      { routeId: '4', stopId: '238' },
    ]),
    activePeriods: [{ start: iso(Date.now() - HOUR), end: iso(Date.now() + HOUR) }],
  }

  it('drops runs inside the window and keeps the ones after it', () => {
    const now = Date.now()
    const out = filterSkippedDepartures(
      [dep('2', now + 5 * 60_000), dep('4', now + 2 * HOUR)],
      [skip],
      ['238'],
    )
    // The 2 "in 5 minutes" is a train that will not stop; the 4 two hours
    // out departs after the station reopens.
    expect(out.map(d => d.route!.id)).toEqual(['4'])
  })

  it('leaves other routes and other stops alone', () => {
    const now = Date.now()
    const out = filterSkippedDepartures(
      [dep('5', now + 5 * 60_000)],
      [skip],
      ['238'],
    )
    expect(out).toHaveLength(1)
    expect(filterSkippedDepartures([dep('2', now)], [skip], ['999'])).toHaveLength(1)
  })

  it('matches through any of the stop ids given (platform or parent)', () => {
    const now = Date.now()
    const out = filterSkippedDepartures([dep('3', now)], [skip], ['238N', '238'])
    expect(out).toHaveLength(0)
  })

  it('keeps a run it cannot time', () => {
    const out = filterSkippedDepartures(
      [{ route: { id: '2' } }],
      [skip],
      ['238'],
    )
    expect(out).toHaveLength(1)
  })
})
