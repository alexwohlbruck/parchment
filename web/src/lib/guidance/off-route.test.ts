import { describe, expect, test } from 'vitest'
import { projectLatLng } from '@/lib/map/movement-interpolation'
import { buildNavRoute, pointAt } from './nav-route'
import { GuidanceEngine } from './guidance-engine'
import { DEFAULT_OFF_ROUTE_OPTIONS, OffRouteDetector, offRouteOptionsFor, type OffRouteInput } from './off-route'
import { polyline } from './test-routes'

const onRoute: OffRouteInput = { offset: 0, accuracy: 5, speed: 1.4, courseError: 0, s: 200, distanceToManeuver: 100 }

function fixesToLeave(mode: string, input: Partial<OffRouteInput>, limit = 30): number | null {
  const detector = new OffRouteDetector(offRouteOptionsFor(mode))
  for (let i = 1; i <= limit; i++) if (detector.update({ ...onRoute, ...input })) return i
  return null
}

describe('offRouteOptionsFor', () => {
  test('keeps driving on the defaults and falls back to them for unknown modes', () => {
    expect(offRouteOptionsFor('driving')).toEqual(DEFAULT_OFF_ROUTE_OPTIONS)
    expect(offRouteOptionsFor('hovercraft')).toEqual(DEFAULT_OFF_ROUTE_OPTIONS)
    expect(offRouteOptionsFor('biking')).toEqual(offRouteOptionsFor('cycling'))
  })
})

describe('OffRouteDetector', () => {
  test('walking leaves the route at 25 m sustained with good GPS', () => {
    expect(fixesToLeave('walking', { offset: 25 })).toBe(3)
    expect(fixesToLeave('walking', { offset: 18 })).toBeNull()
  })

  test('cycling sits between walking and driving', () => {
    expect(fixesToLeave('cycling', { offset: 25 })).toBeNull()
    expect(fixesToLeave('cycling', { offset: 35 })).toBe(2)
  })

  test('driving still needs 50 m', () => {
    expect(fixesToLeave('driving', { offset: 45, speed: 10 })).toBeNull()
    expect(fixesToLeave('driving', { offset: 55, speed: 10 })).toBe(2)
  })

  test('walking ignores a single far fix with poor accuracy', () => {
    const detector = new OffRouteDetector(offRouteOptionsFor('walking'))
    for (let i = 0; i < 5; i++) detector.update(onRoute)
    expect(detector.update({ ...onRoute, offset: 45, accuracy: 30 })).toBe(false)
    for (let i = 0; i < 5; i++) expect(detector.update(onRoute)).toBe(false)
  })

  test('the departure grace forgives a start beside the route, not one far from it', () => {
    expect(fixesToLeave('driving', { s: 0, offset: 120 })).toBeNull()
    expect(fixesToLeave('driving', { s: 0, offset: 2000 })).toBe(2)
  })

  test('walking back along the route counts, a sideways course does not', () => {
    expect(fixesToLeave('walking', { courseError: 170 })).toBe(6)
    expect(fixesToLeave('walking', { courseError: 90 })).toBeNull()
  })
})

describe('GuidanceEngine off-route by mode', () => {
  function secondsToLeave(mode: string): number | null {
    const route = buildNavRoute([{ mode, geometry: polyline([[0, 600]]) }])
    const engine = new GuidanceEngine(route)
    for (let t = 1; t <= 60; t++) {
      engine.pushFix({ t, position: pointAt(route, 1.4 * t), accuracy: 8, speed: 1.4, heading: 0 })
    }
    let position = pointAt(route, 1.4 * 60)
    for (let t = 1; t <= 40; t++) {
      position = projectLatLng(position, 1.4, 90, 1)
      engine.pushFix({ t: 60 + t, position, accuracy: 8, speed: 1.4, heading: 90 })
      if (engine.isOffRoute) return t
    }
    return null
  }

  test('a walker turning off the route is noticed once about 24 m away', () => {
    const seconds = secondsToLeave('walking')!
    expect(seconds).toBeGreaterThanOrEqual(15)
    expect(seconds).toBeLessThanOrEqual(18)
  })

  test('the same walk on a driving route takes 50 m to leave it', () => {
    expect(secondsToLeave('driving')).toBeGreaterThanOrEqual(36)
  })
})
