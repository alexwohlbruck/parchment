import { describe, expect, test } from 'vitest'
import type { DepartureProfile, DepartureRun } from '@/types/multimodal.types'
import { translator } from '@/lib/guidance/test-routes'
import en from '@/lib/i18n/en-US.json'
import {
  adviceBadges,
  adviceReach,
  raceZones,
  adviceValidUntil,
  boardsAtMs,
  crossover,
  crossoverText,
  isFuturePlan,
  tripAdvice,
  walksToFirstStop,
  type AdviceState,
  type AdviceSurface,
  type AdviceTrip,
  type Race,
  type TripAdvice,
} from './trip-advice'
import { formatClockCompact } from './trip-display'

const t = translator(en)
const BASE = Date.parse('2026-11-04T08:00:00')
const at = (min: number) => new Date(BASE + min * 60_000).toISOString()
const now = (min: number) => BASE + min * 60_000
const clock = (min: number) => formatClockCompact(new Date(now(min)))

/** A run leaving the door at `leave`, boarding 5 min later, arriving at `arrive` (minutes past 8:00). */
function run(leave: number, arrive: number, extra: Partial<DepartureRun> = {}): DepartureRun {
  return { leaveBy: at(leave), departAt: at(leave + 5), arriveAt: at(arrive), live: true, ...extra }
}

function profile(runs: DepartureRun[], plannedRunIndex = 0, validUntil = 90): DepartureProfile {
  return { runs, plannedRunIndex, validUntil: at(validUntil) }
}

describe('tripAdvice', () => {
  test('says nothing without a profile or runs', () => {
    expect(tripAdvice(undefined, now(0))).toBeNull()
    expect(tripAdvice(profile([]), now(0))).toBeNull()
  })

  test('hurry when the lead is inside the transit buffer', () => {
    const advice = tripAdvice(profile([run(10, 40), run(20, 50)]), now(9))
    expect(advice?.state).toEqual({
      kind: 'hurry',
      race: { departAtMs: now(15), walkMs: 5 * 60_000, spareMs: 60_000, bufferMs: 2 * 60_000, runFactor: null },
      next: { departAtMs: now(25), laterMin: 10 },
    })
  })

  test('the buffer comes from the rider', () => {
    const p = profile([run(10, 40), run(20, 50)])
    expect(tripAdvice(p, now(6), { transitBufferMinutes: 5 })?.state).toMatchObject({ kind: 'hurry', race: { spareMs: 4 * 60_000 } })
    expect(tripAdvice(p, now(6), { transitBufferMinutes: 2 })?.state?.kind).toBe('leave')
  })

  test('leave when the lead is short and missing it is expensive', () => {
    expect(tripAdvice(profile([run(10, 40), run(25, 52)]), now(6))?.state).toMatchObject({ kind: 'leave', nextLaterMin: 12 })
  })

  test('leave by the planned run when there is time and a miss costs something', () => {
    expect(tripAdvice(profile([run(10, 40), run(20, 46)]), now(0))?.state).toEqual({ kind: 'by', leaveByMs: now(10) })
  })

  test('leave-by extends to a later run with the same arrival', () => {
    const p = profile([run(10, 40), run(14, 40.5), run(25, 55)])
    expect(tripAdvice(p, now(0))?.state).toEqual({ kind: 'by', leaveByMs: now(14) })
  })

  test('frequent service says nothing, not even hurry', () => {
    const p = profile([run(10, 40), run(13, 43)])
    expect(tripAdvice(p, now(0))?.state).toBeNull()
    expect(tripAdvice(p, now(6))?.state).toBeNull()
    expect(tripAdvice(p, now(9))?.state).toBeNull()
  })

  test('keeps the leave-by time once leaving is close but a miss is only moderately costly', () => {
    expect(tripAdvice(profile([run(10, 40), run(16, 46)]), now(7))?.state).toEqual({ kind: 'by', leaveByMs: now(10) })
  })

  test('still says hurry for the last run in the window', () => {
    expect(tripAdvice(profile([run(10, 40)]), now(9))?.state).toMatchObject({ kind: 'hurry' })
  })

  test('no next run in the window leaves the miss cost unknown', () => {
    expect(tripAdvice(profile([run(10, 40)]), now(0))?.state).toBeNull()
  })

  test('missed once the planned arrival is out of reach', () => {
    const advice = tripAdvice(profile([run(10, 40, { live: true }), run(24, 54, { live: false })]), now(11))
    expect(advice).toMatchObject({ state: { kind: 'missed', departAtMs: now(29), left: false }, live: false })
  })

  test('tells a run that has left from one still coming but out of reach', () => {
    const runs = profile([run(10, 40), run(24, 54)])
    expect(tripAdvice(runs, now(11))?.state).toMatchObject({ kind: 'missed', left: false })
    expect(tripAdvice(runs, now(16))?.state).toMatchObject({ kind: 'missed', left: true })
  })

  test('a passed run with a same-arrival successor is not missed', () => {
    const p = profile([run(10, 40), run(14, 40), run(25, 55)])
    expect(tripAdvice(p, now(11))?.state).toMatchObject({ kind: 'leave', nextLaterMin: 15 })
  })

  test('nothing to say when every run has gone', () => {
    expect(tripAdvice(profile([run(10, 40), run(20, 50)]), now(21))).toBeNull()
  })

  test('a future plan just names the leave time', () => {
    expect(tripAdvice(profile([run(70, 100), run(80, 110)]), now(0), { future: true })?.state).toEqual({ kind: 'by', leaveByMs: now(70) })
  })

  test('the boarding time re-finds the planned run after a rebooking', () => {
    const p = profile([run(10, 40), run(20, 52), run(30, 60)], 0)
    expect(tripAdvice(p, now(0), { boardsAtMs: now(25) })?.state).toEqual({ kind: 'by', leaveByMs: now(20) })
  })

  test('flags a tight transfer on the current run', () => {
    const p = profile([run(10, 40, { minTransferSlackSec: 100, tightestTransferAt: 'Jay St' }), run(20, 50, { minTransferSlackSec: 300 })])
    expect(tripAdvice(p, now(0))?.tight).toEqual({ minutes: 2, stop: 'Jay St' })
    expect(tripAdvice(p, now(12))?.tight).toBeNull()
  })

  test('reports whether the current run is live', () => {
    expect(tripAdvice(profile([run(10, 40, { live: false })]), now(0))?.live).toBe(false)
  })
})

describe('isFuturePlan', () => {
  test('only a depart-at time well ahead counts', () => {
    expect(isFuturePlan(null, now(0))).toBe(false)
    expect(isFuturePlan(at(10), now(0))).toBe(false)
    expect(isFuturePlan(at(45), now(0))).toBe(true)
  })
})

describe('crossover', () => {
  const seg = (mode: string) => ({ mode, duration: 600 })
  const transit = (p: DepartureProfile, rank = 1): AdviceTrip => ({
    rank,
    segments: [seg('walking'), seg('transit')],
    summary: { totalDuration: 1800 },
    departureProfile: p,
  })
  const bike = (durMin: number, rank = 2): AdviceTrip => ({ rank, segments: [seg('cycling')], summary: { totalDuration: durMin * 60 } })

  test('bike wins once waiting for the next run costs more than riding', () => {
    const p = profile([run(10, 40), run(30, 60)])
    expect(crossover([transit(p), bike(45)], now(0))).toEqual({ mode: 'cycling', atMs: now(10) })
  })

  test('never when the transit trip stays ahead', () => {
    const p = profile([run(10, 40), run(15, 45)])
    expect(crossover([transit(p), bike(40)], now(0))).toBeNull()
  })

  test('not when the other mode is already faster now', () => {
    const p = profile([run(10, 40), run(30, 60)])
    expect(crossover([transit(p), bike(20)], now(0))).toBeNull()
  })

  test('stays inside the profile window', () => {
    const p = profile([run(10, 40), run(30, 60)], 0, 5)
    expect(crossover([transit(p), bike(45)], now(0))).toBeNull()
  })

  test('only reads the rank-1 trip', () => {
    const p = profile([run(10, 40), run(30, 60)])
    expect(crossover([bike(45, 1), transit(p, 2)], now(0))).toBeNull()
  })

  test('takes the earliest crossover among modes', () => {
    const p = profile([run(10, 40), run(20, 60), run(30, 70), run(40, 100)])
    const walk: AdviceTrip = { rank: 3, segments: [seg('walking')], summary: { totalDuration: 55 * 60 } }
    expect(crossover([transit(p), walk, bike(45)], now(0))).toEqual({ mode: 'cycling', atMs: now(10) })
  })
})

describe('adviceValidUntil', () => {
  test('the earliest profile expiry among the trips', () => {
    expect(adviceValidUntil([{}, { departureProfile: profile([], 0, 60) }, { departureProfile: profile([], 0, 30) }])).toBe(now(30))
    expect(adviceValidUntil([{}])).toBeNull()
  })
})

describe('boardsAtMs', () => {
  test('the first transit leg', () => {
    const start = new Date(now(5))
    expect(boardsAtMs([{ mode: 'walking', startTime: new Date(now(0)) }, { mode: 'transit', startTime: start }])).toBe(now(5))
    expect(boardsAtMs([{ mode: 'walking', startTime: start }])).toBeUndefined()
  })
})

describe('adviceBadges', () => {
  const race = (spareMin: number): Race => ({ departAtMs: now(12), walkMs: 5 * 60_000, spareMs: spareMin * 60_000, bufferMs: 2 * 60_000, runFactor: null })
  const texts = (state: AdviceState | null, surface: AdviceSurface, extra: Partial<TripAdvice> = {}) =>
    adviceBadges({ state, tight: null, live: true, ...extra }, t, surface).map(b => b.text)

  test('the trip page weighs the walk against the train', () => {
    expect(texts({ kind: 'leave', nextLaterMin: 12, race: race(3.5) }, 'header')).toEqual(['Leave now', '3 min spare'])
    expect(texts({ kind: 'hurry', race: race(0.4) }, 'header')).toEqual(['Hurry', '<1 min spare'])
    expect(texts({ kind: 'run', race: race(-1.5) }, 'header')).toEqual(['Run', '2 min short'])
    expect(texts({ kind: 'missed', departAtMs: now(24), left: false }, 'header')).toEqual(['Too far', `Next ${clock(24)}`])
    expect(texts({ kind: 'by', leaveByMs: now(31) }, 'header', { live: false })).toEqual([`Leave by ${clock(31)}`, 'No live times'])
  })

  test('a result card names the run and what waiting costs', () => {
    const next = { departAtMs: now(30), laterMin: 6 }
    expect(texts({ kind: 'hurry', race: race(1), next }, 'card', { tight: { minutes: 1, stop: 'Jay St' } }))
      .toEqual(['Hurry', 'Tight', `Departs ${clock(12)}`, 'Next +6 min'])
    expect(texts({ kind: 'leave', nextLaterMin: 20, race: race(2) }, 'card')).toEqual(['Leave now', 'Next +20 min'])
    expect(texts({ kind: 'missed', departAtMs: now(24), left: true }, 'card')).toEqual(['Missed', 'Finding next'])
  })

  test('a tight transfer alone names the stop', () => {
    expect(texts(null, 'card', { tight: { minutes: 1, stop: 'Jay St' } })).toEqual(['Tight', '1 min at Jay St'])
  })

  test('crossover', () => {
    expect(crossoverText({ mode: 'cycling', atMs: now(14) }, t)).toBe(`Bike faster after ${clock(14)}`)
  })
})

describe('run', () => {
  // Leave the door at 10, board at 15: a 5 min walk.
  test('says run when a jog still makes a run that walking misses', () => {
    const advice = tripAdvice(profile([run(10, 40), run(24, 54)]), now(12), { runFactor: 1.8 })
    expect(advice?.state).toMatchObject({ kind: 'run', race: { departAtMs: now(15), spareMs: -2 * 60_000 } })
  })

  test('says run as soon as the leave time has passed', () => {
    const advice = tripAdvice(profile([run(10, 40), run(24, 54)]), now(11), { runFactor: 1.8 })
    expect(advice?.state).toMatchObject({ kind: 'run', race: { departAtMs: now(15), spareMs: -60_000 } })
  })

  test('misses it instead without a run factor or too late for a jog', () => {
    expect(tripAdvice(profile([run(10, 40), run(24, 54)]), now(12))?.state?.kind).toBe('missed')
    expect(tripAdvice(profile([run(10, 40), run(24, 54)]), now(13), { runFactor: 1.8 })?.state?.kind).toBe('missed')
  })

  test('lets a run go quietly when the next one is close behind', () => {
    expect(tripAdvice(profile([run(10, 40), run(16, 46), run(30, 60)]), now(11), { runFactor: 1.8 })?.state)
      .toEqual({ kind: 'by', leaveByMs: now(16) })
    expect(tripAdvice(profile([run(10, 40), run(13, 43), run(16, 46)]), now(11), { runFactor: 1.8 })?.state).toBeNull()
  })

  test('runs once the next one is well behind', () => {
    const advice = tripAdvice(profile([run(10, 40), run(18, 48)]), now(11), { runFactor: 1.8 })
    expect(advice?.state).toMatchObject({ kind: 'run', next: { departAtMs: now(23), laterMin: 8 } })
  })

  test('reads the live departure and the walk still ahead, as the board does', () => {
    const p = profile([run(10, 40), run(30, 60)])
    const at = now(9.5)
    expect(tripAdvice(p, at, { runFactor: 1.8 })?.state?.kind).toBe('hurry')
    const boarding = { departAtMs: now(14), walkSec: 5 * 60 }
    expect(tripAdvice(p, at, { runFactor: 1.8, boarding })?.state).toMatchObject({ kind: 'run', race: { departAtMs: now(14) } })
  })

  test('marks where along the walk each piece of advice begins', () => {
    const min = 60_000
    const zones = raceZones({ departAtMs: 0, walkMs: 0, spareMs: 0, bufferMs: 2 * min, runFactor: 1.5 }, 10 * min)
    expect(zones.map(z => [z.kind, z.fromMs / min, z.toMs / min])).toEqual([
      ['calm', 0, 5], ['leave', 5, 8], ['hurry', 8, 10], ['run', 10, 15], ['tooFar', 15, Infinity],
    ])
    expect(raceZones({ departAtMs: 0, walkMs: 0, spareMs: 0, bufferMs: 2 * min, runFactor: null }, min).map(z => z.kind))
      .toEqual(['hurry', 'tooFar'])
  })

  test('the board word for the planned run follows the advice', () => {
    expect(adviceReach({ kind: 'run', race: { departAtMs: 0, walkMs: 0, spareMs: -1, bufferMs: 0, runFactor: null } })).toBe('run')
    expect(adviceReach({ kind: 'missed', departAtMs: 0, left: false })).toBe('unreachable')
    expect(adviceReach({ kind: 'by', leaveByMs: 0 })).toBe('ok')
    expect(adviceReach(null)).toBe('ok')
  })

  test('only a trip that reaches its first stop on foot can be run for', () => {
    expect(walksToFirstStop([{ mode: 'walking' }, { mode: 'transit' }])).toBe(true)
    expect(walksToFirstStop([{ mode: 'biking' }, { mode: 'transit' }])).toBe(false)
    expect(walksToFirstStop([{ mode: 'transit' }])).toBe(false)
  })
})
