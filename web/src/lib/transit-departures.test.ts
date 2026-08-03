import { describe, it, expect } from 'vitest'
import { groupDepartures } from './transit-departures'
import type { TransitDeparture } from '@/types/place.types'

const NOW = new Date('2026-08-03T12:00:00Z')
const OPTS = { unknownDirectionLabel: 'Unknown' }

/** `minutes` from now; `null` for a departure with no resolvable time. */
function dep(
  route: string,
  headsign: string | null,
  minutes: number | null,
  extra: Partial<TransitDeparture> = {},
): TransitDeparture {
  return {
    route: { id: `r-${route}`, shortName: route },
    headsign,
    departureAt:
      minutes === null
        ? null
        : new Date(NOW.getTime() + minutes * 60_000).toISOString(),
    realTime: false,
    ...extra,
  } as unknown as TransitDeparture
}

describe('groupDepartures', () => {
  it('returns nothing for an empty board', () => {
    expect(groupDepartures([], NOW, OPTS)).toEqual([])
  })

  it('groups by route, then by direction', () => {
    const groups = groupDepartures(
      [
        dep('4', 'Uptown', 3),
        dep('4', 'Downtown', 5),
        dep('5', 'Uptown', 7),
      ],
      NOW,
      OPTS,
    )
    expect(groups).toHaveLength(2)
    expect(groups[0].routeKey).toBe('4')
    expect(groups[0].directions.map(d => d.headsign)).toEqual(['Uptown', 'Downtown'])
    expect(groups[1].directions).toHaveLength(1)
  })

  it('drops departures more than a minute past', () => {
    const groups = groupDepartures([dep('4', 'Uptown', -5), dep('4', 'Uptown', 3)], NOW, OPTS)
    expect(groups[0].directions[0].departures).toHaveLength(1)
  })

  it('keeps a departure that has only just gone, since riders may still catch it', () => {
    const groups = groupDepartures([dep('4', 'Uptown', -1)], NOW, OPTS)
    expect(groups[0].directions[0].departures).toHaveLength(1)
  })

  it('sorts soonest first', () => {
    const groups = groupDepartures(
      [dep('4', 'Uptown', 20), dep('4', 'Uptown', 2), dep('4', 'Uptown', 9)],
      NOW,
      OPTS,
    )
    const order = groups[0].directions[0].departures.map(d => d.departureAt)
    expect(order).toEqual([...order].sort())
  })

  it('sorts unknown times last, not to the front', () => {
    const groups = groupDepartures(
      [dep('4', 'Uptown', null), dep('4', 'Uptown', 5)],
      NOW,
      OPTS,
    )
    expect(groups[0].directions[0].departures[0].departureAt).not.toBeNull()
  })

  it('sorts a far-future departure ahead of an unknown one', () => {
    // The page previously used `?? 9999` as the null sentinel, so anything
    // beyond ~7 days sorted after departures with no time at all.
    const groups = groupDepartures(
      [dep('4', 'Uptown', null), dep('4', 'Uptown', 20_000)],
      NOW,
      OPTS,
    )
    expect(groups[0].directions[0].departures[0].departureAt).not.toBeNull()
  })

  it('falls back to the supplied label when a departure names no direction', () => {
    const groups = groupDepartures([dep('4', null, 3)], NOW, OPTS)
    expect(groups[0].directions[0].headsign).toBe('Unknown')
  })

  it('limits each direction when asked, without affecting grouping', () => {
    const departures = [1, 2, 3, 4, 5].map(m => dep('4', 'Uptown', m))
    expect(groupDepartures(departures, NOW, OPTS)[0].directions[0].departures).toHaveLength(5)
    expect(
      groupDepartures(departures, NOW, { ...OPTS, limit: 3 })[0].directions[0].departures,
    ).toHaveLength(3)
  })

  it('reports realtime from every run, not just the visible ones', () => {
    // The live indicator means "this direction has predictions", so a limit
    // must not hide it.
    const departures = [
      dep('4', 'Uptown', 1),
      dep('4', 'Uptown', 2),
      dep('4', 'Uptown', 3),
      dep('4', 'Uptown', 9, { realTime: true }),
    ]
    const limited = groupDepartures(departures, NOW, { ...OPTS, limit: 3 })
    expect(limited[0].directions[0].departures).toHaveLength(3)
    expect(limited[0].directions[0].hasRealtime).toBe(true)
  })

  it('keys a route by short name, long name, then id', () => {
    const noShort = {
      route: { id: 'r-1', longName: 'Red Line' },
      headsign: 'North',
      departureAt: new Date(NOW.getTime() + 60_000).toISOString(),
    } as unknown as TransitDeparture
    expect(groupDepartures([noShort], NOW, OPTS)[0].routeKey).toBe('Red Line')
  })

  it('does not mutate the input', () => {
    const departures = [dep('4', 'Uptown', 9), dep('4', 'Uptown', 2)]
    const before = [...departures]
    groupDepartures(departures, NOW, OPTS)
    expect(departures).toEqual(before)
  })
})
