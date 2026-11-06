import { describe, expect, test } from 'vitest'
import type { DepartureProfile, DepartureRun } from '@/types/multimodal.types'
import { translator } from '@/lib/guidance/test-routes'
import en from '@/lib/i18n/en-US.json'
import {
  adviceText,
  adviceValidUntil,
  boardingLeg,
  cardHint,
  crossover,
  crossoverText,
  isFuturePlan,
  tightText,
  tripAdvice,
  walksToFirstStop,
  type AdviceTrip,
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
    expect(advice?.state).toEqual({ kind: 'hurry', leadMin: 1, departAtMs: now(15) })
  })

  test('the buffer comes from the rider', () => {
    const p = profile([run(10, 40), run(20, 50)])
    expect(tripAdvice(p, now(6), { transitBufferMinutes: 5 })?.state).toMatchObject({ kind: 'hurry', leadMin: 4 })
    expect(tripAdvice(p, now(6), { transitBufferMinutes: 2 })?.state?.kind).toBe('leave')
  })

  test('leave when the lead is short and missing it is expensive', () => {
    expect(tripAdvice(profile([run(10, 40), run(25, 52)]), now(6))?.state).toEqual({ kind: 'leave', nextLaterMin: 12 })
  })

  test('leave by the planned run when there is time and a miss costs something', () => {
    expect(tripAdvice(profile([run(10, 40), run(20, 46)]), now(0))?.state).toEqual({ kind: 'by', leaveByMs: now(10) })
  })

  test('leave-by extends to a later run with the same arrival', () => {
    const p = profile([run(10, 40), run(14, 40.5), run(25, 55)])
    expect(tripAdvice(p, now(0))?.state).toEqual({ kind: 'by', leaveByMs: now(14) })
  })

  test('frequent service says nothing', () => {
    const p = profile([run(10, 40), run(13, 43)])
    expect(tripAdvice(p, now(0))?.state).toBeNull()
    expect(tripAdvice(p, now(6))?.state).toBeNull()
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
    expect(tripAdvice(p, now(11))?.state).toEqual({ kind: 'leave', nextLaterMin: 15 })
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

describe('boardingLeg', () => {
  test('the first transit leg, with its line unless merged', () => {
    const start = new Date(now(5))
    expect(boardingLeg([{ mode: 'walking', startTime: start }, { mode: 'transit', startTime: start, lineName: 'F' }])).toEqual({ departMs: now(5), line: 'F' })
    expect(boardingLeg([{ mode: 'transit', startTime: start, lineName: '4', routeOptions: [{}, {}] }])).toEqual({ departMs: now(5) })
    expect(boardingLeg([{ mode: 'walking', startTime: start }])).toBeNull()
  })
})

describe('copy', () => {
  test('long variants', () => {
    expect(adviceText({ kind: 'leave', nextLaterMin: 12 }, t)).toBe('Leave now · next is 12 min later')
    expect(adviceText({ kind: 'hurry', leadMin: 3, departAtMs: now(12) }, t)).toBe(`Hurry · 3 min to the ${clock(12)}`)
    expect(adviceText({ kind: 'hurry', leadMin: 3, departAtMs: now(12) }, t, 'F')).toBe(`Hurry · 3 min to the F at ${clock(12)}`)
    expect(adviceText({ kind: 'by', leaveByMs: now(31) }, t)).toBe(`Leave by ${clock(31)}`)
    expect(adviceText({ kind: 'missed', departAtMs: now(24), left: true }, t, 'F')).toBe(`Missed · next is the F at ${clock(24)}`)
    expect(adviceText({ kind: 'missed', departAtMs: now(24), left: false }, t)).toBe(`Too far to make it · next is the ${clock(24)}`)
    expect(tightText({ minutes: 2, stop: 'Jay St' }, t)).toBe('2 min to change at Jay St')
    expect(tightText({ minutes: 1 }, t)).toBe('1 min to change')
    expect(crossoverText({ mode: 'cycling', atMs: now(14) }, t)).toBe(`Bike is faster after ${clock(14)}`)
  })
})

describe('cardHint', () => {
  test('pairs the short words with the one fact that matters', () => {
    const hint = cardHint(
      { state: { kind: 'hurry', leadMin: 2, departAtMs: now(24) }, tight: { minutes: 1, stop: 'Jay St' }, live: true },
      t,
      'F',
    )
    expect(hint).toEqual({
      words: [expect.objectContaining({ word: 'Hurry' }), expect.objectContaining({ word: 'Tight' })],
      text: `2 min to the F at ${clock(24)}`,
    })
  })

  test('a tight transfer alone names the stop', () => {
    expect(cardHint({ state: null, tight: { minutes: 1, stop: 'Jay St' }, live: true }, t)).toEqual({
      words: [expect.objectContaining({ word: 'Tight' })],
      text: '1 min to change at Jay St',
    })
  })

  test('calm deadlines stay plain text', () => {
    expect(cardHint({ state: { kind: 'by', leaveByMs: now(10) }, tight: null, live: true }, t)).toEqual({
      words: [],
      text: `Leave by ${clock(10)}`,
    })
  })
})

describe('run', () => {
  // Leave the door at 10, board at 15: a 5 min walk.
  test('says run when a jog still makes a run that walking misses', () => {
    const advice = tripAdvice(profile([run(10, 40), run(24, 54)]), now(12), { runFactor: 1.8 })
    expect(advice?.state).toEqual({ kind: 'run', leadMin: 3, departAtMs: now(15) })
  })

  test('says hurry when a brisk walk is enough', () => {
    const advice = tripAdvice(profile([run(10, 40), run(24, 54)]), now(11), { runFactor: 1.8 })
    expect(advice?.state).toEqual({ kind: 'hurry', leadMin: 4, departAtMs: now(15) })
  })

  test('misses it instead without a run factor, too late for a jog, or with a close next run', () => {
    expect(tripAdvice(profile([run(10, 40), run(24, 54)]), now(12))?.state?.kind).toBe('missed')
    expect(tripAdvice(profile([run(10, 40), run(24, 54)]), now(13), { runFactor: 1.8 })?.state?.kind).toBe('missed')
    expect(tripAdvice(profile([run(10, 40), run(12, 42)]), now(11), { runFactor: 1.8 })?.state?.kind).not.toBe('run')
  })

  test('only a trip that reaches its first stop on foot can be run for', () => {
    expect(walksToFirstStop([{ mode: 'walking' }, { mode: 'transit' }])).toBe(true)
    expect(walksToFirstStop([{ mode: 'biking' }, { mode: 'transit' }])).toBe(false)
    expect(walksToFirstStop([{ mode: 'transit' }])).toBe(false)
  })
})
