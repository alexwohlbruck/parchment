import { describe, it, expect } from 'vitest'
import { MIN_LEG_GAP_MS, cascadeConstraints, stopWindows } from './leg-schedule'
import type { TripOption } from '@/types/directions.types'
import type { WaypointTimeConstraint } from '@/types/map.types'

const at = (time: string) => new Date(`2026-01-15T${time}:00Z`)
const hhmm = (date: Date | null) => date?.toISOString().slice(11, 16) ?? null

/** A trip whose legs run back to back from 08:00. */
function trip(...legs: Array<[string, string]>): TripOption {
  return {
    startTime: at(legs[0][0]),
    segments: legs.map(([start, end], legIndex) => ({
      legIndex, startTime: at(start), endTime: at(end),
    })),
  } as unknown as TripOption
}

const depart = (time: string, dwellTime?: number): WaypointTimeConstraint =>
  ({ mode: 'departAfter', time: at(time).toISOString(), ...(dwellTime && { dwellTime }) })

const arriveBy = (time: string): WaypointTimeConstraint =>
  ({ mode: 'arriveBy', time: at(time).toISOString() })

describe('stopWindows', () => {
  it('has nothing to say before a trip has been planned', () => {
    expect(stopWindows(undefined, [null, null])).toEqual([
      { earliest: null, latest: null, arrivesAt: null },
      { earliest: null, latest: null, arrivesAt: null },
    ])
  })

  it('will not let a stop be left before the trip reaches it', () => {
    // 08:00→08:20, then 08:20→08:50.
    const windows = stopWindows(trip(['08:00', '08:20'], ['08:20', '08:50']), [null, null, null])

    expect(hhmm(windows[1].arrivesAt)).toBe('08:20')
    expect(hhmm(windows[1].earliest)).toBe('08:21')
  })

  it('leaves a minute between arriving and leaving again', () => {
    const windows = stopWindows(trip(['08:00', '08:20'], ['08:20', '08:50']), [null, null, null])
    const gap = windows[1].earliest!.getTime() - windows[1].arrivesAt!.getTime()

    expect(gap).toBe(MIN_LEG_GAP_MS)
  })

  it('carries a later departure through to the stops after it', () => {
    const windows = stopWindows(
      trip(['08:00', '08:20'], ['08:20', '08:50']),
      [null, depart('09:00'), null],
    )

    // Leaving stop 1 at 09:00 means arriving at stop 2 thirty minutes later.
    expect(hhmm(windows[2].arrivesAt)).toBe('09:30')
  })

  it('counts a stay at a stop before the next one can be reached', () => {
    const windows = stopWindows(
      trip(['08:00', '08:20'], ['08:20', '08:50']),
      [null, depart('09:00', 45), null],
    )

    expect(hhmm(windows[2].arrivesAt)).toBe('10:15')
  })

  it('caps a stop by a deadline further along the trip', () => {
    const windows = stopWindows(
      trip(['08:00', '08:20'], ['08:20', '08:50']),
      [null, null, arriveBy('10:00')],
    )

    // Being at stop 2 by 10:00 means leaving stop 1 by 09:30, the 30-minute
    // leg before it.
    expect(hhmm(windows[1].latest)).toBe('09:30')
  })

  it('is not capped by a later stop the rider can simply wait at', () => {
    const windows = stopWindows(
      trip(['08:00', '08:20'], ['08:20', '08:50']),
      [null, null, depart('10:00')],
    )

    expect(windows[1].latest).toBeNull()
  })

  it('has no ceiling when nothing later has been asked for', () => {
    const windows = stopWindows(trip(['08:00', '08:20'], ['08:20', '08:50']), [null, null, null])
    expect(windows[1].latest).toBeNull()
  })

  it('reaches back through the leg when capping an earlier stop', () => {
    const windows = stopWindows(
      trip(['08:00', '08:20'], ['08:20', '08:50']),
      [null, depart('09:00', 30), arriveBy('11:00')],
    )

    expect(hhmm(windows[1].latest)).toBe('10:30')
  })
})

describe('cascadeConstraints', () => {
  const legs = trip(['08:00', '08:20'], ['08:20', '08:50'])

  it('pushes a stop the change has stranded in the past', () => {
    const result = cascadeConstraints(legs, [null, depart('10:00'), depart('09:00')], 1)

    // Leaving stop 1 at 10:00 lands at stop 2 at 10:30, so 09:00 is gone.
    expect(hhmm(new Date(result[2]!.time!))).toBe('10:31')
  })

  it('leaves a stop that is already late enough exactly as set', () => {
    const wanted = depart('12:00')
    const result = cascadeConstraints(legs, [null, depart('10:00'), wanted], 1)

    expect(result[2]).toBe(wanted)
  })

  it('leaves a stop with no instruction free to be planned around', () => {
    const result = cascadeConstraints(legs, [null, depart('10:00'), null], 1)
    expect(result[2]).toBeNull()
  })

  it('keeps a stay when it moves the stop it belongs to', () => {
    const result = cascadeConstraints(
      legs, [null, depart('10:00'), depart('09:00', 20)], 1,
    )

    expect(result[2]!.dwellTime).toBe(20)
  })

  it('touches nothing before the stop that changed', () => {
    const origin = depart('07:00')
    const result = cascadeConstraints(legs, [origin, depart('10:00'), null], 1)

    expect(result[0]).toBe(origin)
  })

  it('moves a run of stops, each pushed off the one before it', () => {
    const result = cascadeConstraints(
      trip(['08:00', '08:20'], ['08:20', '08:50'], ['08:50', '09:10']),
      [null, depart('10:00'), depart('09:00'), depart('09:05')],
      1,
    )

    expect(hhmm(new Date(result[2]!.time!))).toBe('10:31')
    expect(hhmm(new Date(result[3]!.time!))).toBe('10:52')
  })
})
