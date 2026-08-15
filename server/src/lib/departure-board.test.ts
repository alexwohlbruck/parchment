/**
 * Sizing and shaping of a place's departure board.
 *
 * The board is fed by MOTIS's `n`, a plain event count with no time bound, so
 * what it buys swings with service frequency — 50 events is 45 minutes at a
 * subway platform and five hours at a ferry landing. Two failures follow from
 * that and both are what these tests pin down: a busy stop showing barely the
 * next hour, and a quiet neighbour dropping a run weeks out into a board of
 * trains due in minutes.
 */

import { describe, test, expect } from 'bun:test'
import {
  resolveBoardWindow,
  shapeBoard,
  DEFAULT_WINDOW_MINUTES,
  EXPANDED_WINDOW_MINUTES,
} from './departure-board'
import type { TransitDeparture } from '../types/place.types'

function departure(over: Partial<TransitDeparture> & { at: string; route?: string; dir?: string }): TransitDeparture {
  const { at, route = 'R1', dir = '0', ...rest } = over
  return {
    departureAt: at,
    departureTime: at,
    trip: { id: `t-${at}-${dir}`, directionId: Number(dir), routeId: route },
    route: { id: route, shortName: route },
    ...rest,
  } as TransitDeparture
}

describe('resolveBoardWindow', () => {
  test('defaults to the opening window', () => {
    expect(resolveBoardWindow().windowMinutes).toBe(DEFAULT_WINDOW_MINUTES)
  })

  test('asks for enough events to fill the window at a tight headway', () => {
    // 3 hours at a 90-second headway is 120 runs — the ask must clear that.
    expect(resolveBoardWindow(180).events).toBeGreaterThanOrEqual(120)
  })

  test('caps the event count so a full day of a frequent line stays sane', () => {
    const expanded = resolveBoardWindow(EXPANDED_WINDOW_MINUTES)
    expect(expanded.events).toBeLessThanOrEqual(750)
  })

  test('refuses a window past the expanded ceiling', () => {
    expect(resolveBoardWindow(100_000).windowMinutes).toBe(EXPANDED_WINDOW_MINUTES)
  })

  test('ignores a nonsense window', () => {
    expect(resolveBoardWindow(0).windowMinutes).toBe(DEFAULT_WINDOW_MINUTES)
    expect(resolveBoardWindow(-5).windowMinutes).toBe(DEFAULT_WINDOW_MINUTES)
    expect(resolveBoardWindow(NaN).windowMinutes).toBe(DEFAULT_WINDOW_MINUTES)
  })

  test('keeps more per direction on the expanded board', () => {
    expect(resolveBoardWindow(EXPANDED_WINDOW_MINUTES).maxPerDirection).toBeGreaterThan(
      resolveBoardWindow().maxPerDirection,
    )
  })
})

describe('shapeBoard', () => {
  test('merges every stop into one list, soonest first', () => {
    const { departures } = shapeBoard(
      [
        { departures: [departure({ at: '2026-08-15T10:05:00Z' })] },
        { departures: [departure({ at: '2026-08-15T10:01:00Z', route: 'R2' })] },
      ],
      { maxPerDirection: 10 },
    )

    expect(departures.map((d) => d.departureAt)).toEqual([
      '2026-08-15T10:01:00Z',
      '2026-08-15T10:05:00Z',
    ])
  })

  test('caps each route + direction so a frequent line cannot crowd out an hourly one', () => {
    // A 2-minute-headway line against one run an hour later. Without a
    // per-direction cap the frequent line fills the board and the hourly
    // service — the one a rider actually needs to plan around — falls off.
    const frequent = Array.from({ length: 30 }, (_, i) =>
      departure({ at: `2026-08-15T10:${String(i * 2).padStart(2, '0')}:00Z`, route: 'FREQ' }),
    )
    const hourly = departure({ at: '2026-08-15T11:30:00Z', route: 'HOURLY' })

    const { departures } = shapeBoard(
      [{ departures: [...frequent, hourly] }],
      { maxPerDirection: 5 },
    )

    expect(departures.filter((d) => d.route.id === 'FREQ')).toHaveLength(5)
    expect(departures.filter((d) => d.route.id === 'HOURLY')).toHaveLength(1)
  })

  test('counts directions of the same route separately', () => {
    const runs = [
      departure({ at: '2026-08-15T10:00:00Z', dir: '0' }),
      departure({ at: '2026-08-15T10:01:00Z', dir: '0' }),
      departure({ at: '2026-08-15T10:02:00Z', dir: '1' }),
      departure({ at: '2026-08-15T10:03:00Z', dir: '1' }),
    ]

    const { departures } = shapeBoard([{ departures: runs }], { maxPerDirection: 1 })

    expect(departures).toHaveLength(2)
    expect(departures.map((d) => d.trip.directionId)).toEqual([0, 1])
  })

  test('reports more when a stop had runs past what it returned', () => {
    const { hasMore } = shapeBoard(
      [{ departures: [departure({ at: '2026-08-15T10:00:00Z' })], hasMore: true }],
      { maxPerDirection: 10 },
    )

    expect(hasMore).toBe(true)
  })

  test('reports more when the per-direction cap dropped runs', () => {
    const runs = [
      departure({ at: '2026-08-15T10:00:00Z' }),
      departure({ at: '2026-08-15T10:05:00Z' }),
    ]

    expect(shapeBoard([{ departures: runs }], { maxPerDirection: 1 }).hasMore).toBe(true)
  })

  test('reports no more when everything fits', () => {
    const { hasMore } = shapeBoard(
      [{ departures: [departure({ at: '2026-08-15T10:00:00Z' })], hasMore: false }],
      { maxPerDirection: 10 },
    )

    expect(hasMore).toBe(false)
  })

  test('sorts runs with unparseable times to the end rather than to zero', () => {
    const { departures } = shapeBoard(
      [
        { departures: [departure({ at: 'not-a-time', route: 'BAD' })] },
        { departures: [departure({ at: '2026-08-15T10:00:00Z' })] },
      ],
      { maxPerDirection: 10 },
    )

    expect(departures[0].route.id).toBe('R1')
  })
})
