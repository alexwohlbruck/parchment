import { describe, expect, it } from 'vitest'
import {
  departureReachability,
  remainingAccessWalkSec,
} from './transit-reachability'

const NOW = new Date('2026-08-14T14:00:00Z').getTime()
const MIN = 60_000

// Grand Central-ish, and a point ~800m west of it.
const STOP = { lat: 40.7527, lng: -73.9772 }
const BLOCKS_AWAY = { lat: 40.7527, lng: -73.9677 }

describe('remainingAccessWalkSec', () => {
  it('returns the full walk before the rider is due to set off', () => {
    const remaining = remainingAccessWalkSec(
      { plannedSec: 420, arrivalMs: NOW + 10 * MIN },
      NOW,
    )
    expect(remaining).toBe(420)
  })

  it('decays as the plan says the rider should be walking', () => {
    // 3 minutes into a 7 minute walk.
    const remaining = remainingAccessWalkSec(
      { plannedSec: 420, arrivalMs: NOW + 4 * MIN },
      NOW,
    )
    expect(remaining).toBe(240)
  })

  it('reaches zero once the plan has the rider at the stop', () => {
    const remaining = remainingAccessWalkSec(
      { plannedSec: 420, arrivalMs: NOW - 2 * MIN },
      NOW,
    )
    expect(remaining).toBe(0)
  })

  it('prefers the live position over the schedule', () => {
    // The schedule still thinks the rider is 7 minutes out, but they're
    // standing at the stop.
    const remaining = remainingAccessWalkSec(
      {
        plannedSec: 420,
        arrivalMs: NOW + 7 * MIN,
        stop: STOP,
        position: { lat: STOP.lat + 0.0001, lng: STOP.lng },
        accuracyM: 12,
      },
      NOW,
    )
    expect(remaining).toBeLessThan(30)
  })

  it('scales the position estimate by the pace implied by the plan', () => {
    // 800m of planned walk over 400s → 2 m/s, so ~800m out still reads as a
    // few minutes of walking (plus the detour allowance).
    const remaining = remainingAccessWalkSec(
      {
        plannedSec: 400,
        distanceM: 800,
        arrivalMs: NOW + 400_000,
        stop: STOP,
        position: BLOCKS_AWAY,
        accuracyM: 10,
      },
      NOW,
    )
    expect(remaining).toBeGreaterThan(300)
    expect(remaining).toBeLessThanOrEqual(400)
  })

  it('ignores a fix too coarse to place the rider', () => {
    const remaining = remainingAccessWalkSec(
      {
        plannedSec: 420,
        arrivalMs: NOW + 7 * MIN,
        stop: STOP,
        position: STOP,
        accuracyM: 2000,
      },
      NOW,
    )
    expect(remaining).toBe(420)
  })

  it('never exceeds the planned walk', () => {
    const remaining = remainingAccessWalkSec(
      {
        plannedSec: 120,
        arrivalMs: NOW + 60 * MIN,
        stop: STOP,
        position: BLOCKS_AWAY,
        accuracyM: 10,
      },
      NOW,
    )
    expect(remaining).toBe(120)
  })

  it('is zero when there is no approach walk (mid-trip boarding)', () => {
    expect(remainingAccessWalkSec({ plannedSec: 0 }, NOW)).toBe(0)
  })
})

describe('departureReachability', () => {
  const GRACE = 180 // the default 3-minute margin, in seconds

  it('marks past runs departed', () => {
    expect(departureReachability(NOW - MIN, NOW, 0, GRACE)).toBe('departed')
    expect(departureReachability(NOW - MIN, NOW, 420, GRACE)).toBe('departed')
  })

  it('marks upcoming runs inside the remaining walk unreachable', () => {
    expect(departureReachability(NOW + 2 * MIN, NOW, 420, GRACE)).toBe('unreachable')
  })

  it('flags a run you would only just make as hurry', () => {
    // 9 min out, 7 min walk → 2 min spare, under the 3 min margin.
    expect(departureReachability(NOW + 9 * MIN, NOW, 420, GRACE)).toBe('hurry')
  })

  it('is ok once the walk plus the margin fits', () => {
    expect(departureReachability(NOW + 11 * MIN, NOW, 420, GRACE)).toBe('ok')
    expect(departureReachability(NOW + 20 * MIN, NOW, 420, GRACE)).toBe('ok')
  })

  it('never nags when the rider asks for no margin', () => {
    // Grace 0 means "stepping straight on is fine" — only a walk you truly
    // cannot finish downgrades the run.
    expect(departureReachability(NOW + 30_000, NOW, 0, 0)).toBe('ok')
    expect(departureReachability(NOW + 8 * MIN, NOW, 420, 0)).toBe('ok')
    expect(departureReachability(NOW + 6 * MIN, NOW, 420, 0)).toBe('unreachable')
  })

  it('widens the hurry band as the rider asks for more margin', () => {
    const lead = NOW + 9 * MIN
    expect(departureReachability(lead, NOW, 420, 60)).toBe('ok')
    expect(departureReachability(lead, NOW, 420, 300)).toBe('hurry')
  })

  it('applies the margin even with no approach walk to judge', () => {
    // Mid-trip transfer: we can't model the walk, but "leaves inside your
    // margin" is still worth flagging.
    expect(departureReachability(NOW + MIN, NOW, 0, GRACE)).toBe('hurry')
    expect(departureReachability(NOW + 5 * MIN, NOW, 0, GRACE)).toBe('ok')
  })

  it('defaults to no margin when none is given', () => {
    expect(departureReachability(NOW + 8 * MIN, NOW, 420)).toBe('ok')
  })

  it('reopens runs the rider has walked into reach of', () => {
    // A 5-minute-out train with 7 minutes of static walk reads unreachable...
    expect(departureReachability(NOW + 5 * MIN, NOW, 420, GRACE)).toBe('unreachable')
    // ...but is plainly catchable once the walk has decayed to a minute.
    expect(departureReachability(NOW + 5 * MIN, NOW, 60, GRACE)).toBe('ok')
  })
})
