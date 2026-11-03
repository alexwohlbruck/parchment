import { describe, expect, test } from 'vitest'
import { buildNavRoute } from './nav-route'
import { coastSpeed, maneuverLimit, MANEUVER_OVERRUN, plausibleSpeed, reachAhead } from './dead-reckoning'
import { cityDrive, polyline } from './test-routes'

describe('plausibleSpeed', () => {
  test('bounds a walker far below a driver, and a driver by the road', () => {
    const walk = buildNavRoute([{ mode: 'walking', geometry: polyline([[0, 300]]) }])
    expect(plausibleSpeed(walk, 100)).toBe(2.5)
    const drive = buildNavRoute([cityDrive()])
    expect(plausibleSpeed(drive, 100)).toBeCloseTo((50 / 3.6) * 1.5, 5)
  })
})

describe('reachAhead', () => {
  test('carries on at the next segment’s pace once a walk ends at a station', () => {
    const route = buildNavRoute([
      { mode: 'walking', geometry: polyline([[0, 100]]) },
      { mode: 'transit', geometry: polyline([[0, 5000]], polyline([[0, 100]]).at(-1)!) },
    ])
    expect(reachAhead(route, 0, 20)).toBeCloseTo(50, 5)
    expect(reachAhead(route, 0, 60)).toBeCloseTo(100 + 20 * 40, 0)
  })
})

describe('maneuverLimit', () => {
  test('lets an estimate run only just past the next maneuver', () => {
    const route = buildNavRoute([cityDrive()])
    expect(maneuverLimit(route, 100)).toBeCloseTo(600 + MANEUVER_OVERRUN, 0)
    expect(maneuverLimit(route, 700)).toBeCloseTo(1000 + MANEUVER_OVERRUN, 0)
  })
})

describe('coastSpeed', () => {
  const base = { mode: 'walking', speed: 1.4, lostFor: 30, stepSpeed: null, still: null }

  test('stands still when the sensors say so, and walks at the step pace', () => {
    expect(coastSpeed({ ...base, still: true }).speed).toBe(0)
    expect(coastSpeed({ ...base, stepSpeed: 1.2 }).speed).toBe(1.2)
  })

  test('settles a fast vehicle toward a modest speed, never speeding up a slow one', () => {
    const early = coastSpeed({ ...base, mode: 'driving', speed: 25, lostFor: 2 }).speed
    const late = coastSpeed({ ...base, mode: 'driving', speed: 25, lostFor: 120 }).speed
    expect(early).toBeGreaterThan(20)
    expect(late).toBeLessThan(9)
    expect(coastSpeed({ ...base, mode: 'driving', speed: 3 }).speed).toBe(3)
  })
})
