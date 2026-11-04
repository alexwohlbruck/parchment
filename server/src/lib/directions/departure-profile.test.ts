import { describe, test, expect } from 'bun:test'
import { buildTripTiming, coverBoards, readTripLegs, type CoveredBoard } from './departure-profile'
import type { TripSegment } from '../../types/trip.types'

const T = Date.parse('2026-11-04T10:00:00Z')
const ms = (min: number) => T + min * 60_000
const at = (min: number) => new Date(ms(min)).toISOString()

const street = (mode: TripSegment['mode'], minutes: number, waitMinutes = 0) =>
  ({ mode, duration: minutes * 60, waitSeconds: waitMinutes * 60 }) as TripSegment

function ride(
  route: string,
  stop: string,
  departMin: number,
  arriveMin: number,
  extra: { routeOptions?: string[]; tripId?: string; directionId?: string } = {},
): TripSegment {
  return {
    mode: 'transit',
    startTime: at(departMin),
    endTime: at(arriveMin),
    duration: (arriveMin - departMin) * 60,
    details: {
      transitDetails: {
        route: { shortName: route },
        routeOptions: extra.routeOptions?.map((shortName) => ({ shortName })),
        trip: { id: extra.tripId ?? '' },
        directionId: extra.directionId ?? '0',
        departureStop: { name: stop, departureTime: at(departMin) },
        arrivalStop: { name: `${stop} exit`, arrivalTime: at(arriveMin) },
      },
    },
  } as unknown as TripSegment
}

const run = (route: string, min: number, extra: Record<string, unknown> = {}) => ({
  route: { shortName: route },
  directionId: '0',
  departureTime: at(min),
  realTime: true,
  ...extra,
})

const timingOf = (segments: TripSegment[], boards: Array<CoveredBoard | null>, notBeforeMs: number) =>
  buildTripTiming(readTripLegs(segments)!, boards, notBeforeMs)

const board = (departures: CoveredBoard['departures'], fromMin: number, untilMin: number): CoveredBoard =>
  ({ departures, fromMs: ms(fromMin), untilMs: ms(untilMin) })

describe('buildTripTiming — one ride', () => {
  const segments = [street('walking', 7, 2), ride('A', 'Nostrand Av', 7, 27), street('walking', 3)]
  const aBoard = board([
    run('A', 1), run('A', 4), run('A', 7), run('A', 12), run('A', 19),
    run('A', 27), run('A', 35), run('A', 44),
    run('A', 9, { directionId: '1' }),
    run('A', 15, { cancelled: true }),
    run('C', 10),
  ], -15, 50)

  const timing = timingOf(segments, [aBoard], ms(0))!

  test('leaves the moving access time before each run and arrives after the ride and egress', () => {
    const planned = timing.profile.runs[timing.profile.plannedRunIndex]
    expect(planned).toEqual({ leaveBy: at(2), departAt: at(7), arriveAt: at(30), live: true })
    expect(timing.profile.runs.map((r) => r.departAt)).toEqual([4, 7, 12, 19, 27, 35].map(at))
    expect(timing.profile.runs[2].arriveAt).toBe(at(35))
  })

  test('skips other directions, other lines and cancelled runs', () => {
    const departs = timing.profile.runs.map((r) => r.departAt)
    expect(departs).not.toContain(at(9))
    expect(departs).not.toContain(at(10))
    expect(departs).not.toContain(at(15))
  })

  test('keeps earlier runs only while they can still be caught', () => {
    expect(timing.profile.plannedRunIndex).toBe(1)
    expect(timing.profile.runs[0].leaveBy).toBe(at(-1))
  })

  test('covers about half an hour of leave times and says where it stops', () => {
    expect(timing.profile.validUntil).toBe(at(30))
    expect(timing.plannedTransfers).toEqual([])
  })

  test('never reaches past the end of the board', () => {
    const short = timingOf(segments, [board(aBoard.departures, -15, 20)], ms(0))!
    expect(short.profile.runs.map((r) => r.departAt)).toEqual([4, 7, 12, 19].map(at))
  })
})

describe('buildTripTiming — a transfer', () => {
  const segments = [
    street('walking', 3, 1),
    ride('B49', 'Bedford Av', 6, 11, { tripId: 'b-own' }),
    street('walking', 7, 2),
    ride('4', 'Franklin Av', 18, 34, { routeOptions: ['4', '5'] }),
    street('walking', 1),
  ]
  const busBoard = board([
    run('B49', 6, { tripId: 'b-own' }), run('B49', 14), run('B49', 22), run('B49', 30),
  ], -15, 40)
  const subwayBoard = board([
    run('4', 18, { realTime: false }), run('5', 21), run('4', 26), run('5', 31),
  ], 0, 40)

  const timing = timingOf(segments, [busBoard, subwayBoard], ms(0))!

  test('times the planned run from the trip itself', () => {
    expect(timing.profile.runs[timing.profile.plannedRunIndex]).toEqual({
      leaveBy: at(4),
      departAt: at(6),
      arriveAt: at(35),
      minTransferSlackSec: 120,
      tightestTransferAt: 'Franklin Av',
      live: false,
    })
  })

  test('chains a later run through the next train at the transfer', () => {
    expect(timing.profile.runs[1]).toEqual({
      leaveBy: at(12),
      departAt: at(14),
      arriveAt: at(43),
      minTransferSlackSec: 120,
      tightestTransferAt: 'Franklin Av',
      live: true,
    })
  })

  test('stops the profile where a connection has no run on its board', () => {
    expect(timing.profile.runs).toHaveLength(2)
    expect(timing.profile.validUntil).toBe(at(12))
  })

  test('prices a missed transfer by the next train after the planned one', () => {
    expect(timing.plannedTransfers).toEqual([{ slackSec: 120, missDelaySec: 180 }])
  })

  test('bounds the miss delay by the board when no later train is shown', () => {
    const thin = board([run('4', 18)], 0, 40)
    const bounded = timingOf(segments, [busBoard, thin], ms(0))!
    expect(bounded.plannedTransfers).toEqual([{ slackSec: 120, missDelaySec: 22 * 60 }])
  })
})

describe('buildTripTiming — board quirks', () => {
  const segments = [street('walking', 2), ride('2', '96 St', 10, 30, { tripId: 'own', routeOptions: ['2', '3'] }), street('walking', 1)]

  test('orders runs by time when the own run sits off its planned minute', () => {
    const drifted = board([run('3', 9), run('2', 11, { tripId: 'own' }), run('3', 14)], 0, 40)
    const timing = timingOf(segments, [drifted], ms(0))!
    expect(timing.profile.runs.map((r) => r.departAt)).toEqual([9, 10, 14].map(at))
    expect(timing.profile.plannedRunIndex).toBe(1)
  })

  test('collapses lines leaving at the same minute into one run', () => {
    const twins = board([run('2', 10, { tripId: 'own' }), run('2', 16), run('3', 16)], 0, 40)
    const timing = timingOf(segments, [twins], ms(0))!
    expect(timing.profile.runs.map((r) => r.departAt)).toEqual([10, 16].map(at))
  })
})

describe('buildTripTiming — street time', () => {
  test('counts parking between street legs but not the wait before boarding', () => {
    const drive = { ...street('driving', 3), startTime: at(0), endTime: at(3) }
    const walk = { ...street('walking', 1), startTime: at(8), endTime: at(9) }
    const segments = [drive, walk, ride('C', 'Euclid Av', 12, 30), street('walking', 2)]
    const timing = timingOf(segments, [board([run('C', 12)], 0, 40)], ms(0))!
    expect(timing.profile.runs[0].leaveBy).toBe(at(3))
  })
})

describe('buildTripTiming — missing data', () => {
  const segments = [street('walking', 5), ride('A', 'Nostrand Av', 5, 25), street('walking', 2)]

  test('needs a board for every leg', () => {
    expect(timingOf(segments, [null], ms(0))).toBeNull()
    expect(timingOf(segments, [], ms(0))).toBeNull()
  })

  test('needs the trip own run on the board', () => {
    expect(timingOf(segments, [board([run('A', 9), run('A', 15)], 0, 40)], ms(0))).toBeNull()
  })

  test('treats a cancelled own run as missing, not late', () => {
    const cancelled = board([run('A', 5, { cancelled: true }), run('A', 12)], 0, 40)
    expect(timingOf(segments, [cancelled], ms(0))).toBeNull()
  })

  test('has nothing to say about a trip without transit', () => {
    expect(readTripLegs([street('walking', 30)])).toBeNull()
  })
})

describe('coverBoards', () => {
  const window = { fromMs: ms(0), untilMs: ms(60) }

  test('trusts a board short of the cap for the whole window', () => {
    const covered = coverBoards([{ departures: [run('A', 5)] }, { departures: [run('C', 9)] }], window, 3)
    expect(covered.departures).toHaveLength(2)
    expect(covered.untilMs).toBe(ms(60))
  })

  test('ends a full board at its last run', () => {
    const full = { departures: [run('A', 5), run('A', 20), run('A', 12)] }
    expect(coverBoards([full], window, 3).untilMs).toBe(ms(20))
  })
})
