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
  it('marks past runs departed', () => {
    expect(departureReachability(NOW - MIN, NOW, 0)).toBe('departed')
    expect(departureReachability(NOW - MIN, NOW, 420)).toBe('departed')
  })

  it('marks upcoming runs inside the remaining walk unreachable', () => {
    expect(departureReachability(NOW + 2 * MIN, NOW, 420)).toBe('unreachable')
  })

  it('flags a tight but catchable run as hurry', () => {
    expect(departureReachability(NOW + 9 * MIN, NOW, 420)).toBe('hurry')
  })

  it('is ok with comfortable slack', () => {
    expect(departureReachability(NOW + 20 * MIN, NOW, 420)).toBe('ok')
  })

  it('never reports hurry without an approach walk', () => {
    expect(departureReachability(NOW + 30_000, NOW, 0)).toBe('ok')
  })

  it('reopens runs the rider has walked into reach of', () => {
    // A 5-minute-out train with 7 minutes of static walk reads unreachable...
    expect(departureReachability(NOW + 5 * MIN, NOW, 420)).toBe('unreachable')
    // ...but is plainly catchable once the walk has decayed to a minute.
    expect(departureReachability(NOW + 5 * MIN, NOW, 60)).toBe('ok')
  })
})
