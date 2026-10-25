import { describe, expect, test } from 'vitest'
import { distanceMeters, projectLatLng } from '@/lib/map/movement-interpolation'
import {
  bearingAt,
  buildNavRoute,
  edgeAt,
  pointAt,
  routeAhead,
  segmentAt,
  smoothedBearingAt,
  stepIndexAt,
  type NavSegmentInput,
} from './nav-route'
import { cityDrive, polyline } from './test-routes'

describe('buildNavRoute', () => {
  const route = buildNavRoute([cityDrive()])

  test('measures the whole leg', () => {
    expect(route.length).toBeCloseTo(1500, -1)
  })

  test('places each instruction at its distance along the route', () => {
    expect(route.steps.map(s => Math.round(s.startDistance))).toEqual([0, 600, 1000, 1500])
  })

  test('rebases edge attributes and segments onto route distance', () => {
    const second = buildNavRoute([
      cityDrive(),
      { mode: 'walking', geometry: polyline([[180, 100]], cityDrive().geometry!.at(-1)), edgeSegments: [{ startDistance: 0, endDistance: 100, speedLimit: 5 }] },
    ])
    expect(segmentAt(second, 1550)?.mode).toBe('walking')
    expect(edgeAt(second, 1550)?.speedLimit).toBe(5)
    expect(edgeAt(second, 200)?.speedLimit).toBe(50)
  })
})

describe('lookups by distance', () => {
  const route = buildNavRoute([cityDrive()])

  test('pointAt lands on the polyline', () => {
    const p = pointAt(route, 300)
    expect(distanceMeters(p, route.points[0])).toBeCloseTo(300, -1)
  })

  test('bearings follow the legs', () => {
    expect(bearingAt(route, 300)).toBeCloseTo(0, 0)
    expect(bearingAt(route, 800)).toBeCloseTo(90, 0)
  })

  test('smoothed bearing turns gradually through a corner', () => {
    const atCorner = smoothedBearingAt(route, 600, 20)
    expect(atCorner).toBeGreaterThan(30)
    expect(atCorner).toBeLessThan(60)
  })

  test('stepIndexAt reports the last maneuver passed', () => {
    expect(stepIndexAt(route, 10)).toBe(0)
    expect(stepIndexAt(route, 700)).toBe(1)
    expect(stepIndexAt(route, 1200)).toBe(2)
  })
})

describe('routeAhead', () => {
  const route = buildNavRoute([{ mode: 'driving', geometry: polyline([[0, 1000], [90, 1000]]) }])

  test('starts at the traveller and runs to the end', () => {
    const ahead = routeAhead(route, 500)
    expect(distanceMeters(ahead[0], pointAt(route, 500))).toBeLessThan(0.5)
    expect(ahead.at(-1)).toEqual(route.points.at(-1))
  })

  test('thins long routes to the point budget', () => {
    const dense = buildNavRoute([{ mode: 'driving', geometry: polyline(Array.from({ length: 2000 }, () => [0, 5] as [number, number])) }])
    const ahead = routeAhead(dense, 0, 500)
    expect(ahead.length).toBeLessThanOrEqual(500)
    expect(ahead.at(-1)).toEqual(dense.points.at(-1))
  })
})

describe('lane line', () => {
  /** cityDrive drawn 2 m to the right of its centreline, as barrelman would put it in a lane. */
  function lanedDrive(): NavSegmentInput {
    const drive = cityDrive()
    const centre = buildNavRoute([drive])
    const coordinates = centre.points.map((p, i) => {
      const q = projectLatLng(p, 2, bearingAt(centre, Math.max(0, centre.cumulative[i] - 0.01)) + 90, 1)
      return [q.lng, q.lat] as [number, number]
    })
    return {
      ...drive,
      drivingSide: 'right',
      laneGeometry: { coordinates, measures: Array.from(centre.cumulative) },
      lanePlan: [{ instruction: 1, lanes: [{ arrows: ['through'], valid: false, recommended: false }, { arrows: ['right'], valid: true, recommended: true }] }],
    }
  }

  test('measures the lane line in route distance', () => {
    const route = buildNavRoute([lanedDrive()])
    expect(route.laneLine?.length).toBe(route.length)
    expect(distanceMeters(pointAt(route.laneLine!, 300), pointAt(route, 300))).toBeCloseTo(2, 0)
  })

  test('puts each lane plan on its step', () => {
    const route = buildNavRoute([lanedDrive()])
    expect(route.steps[1].lanePlan?.lanes.map(l => l.recommended)).toEqual([false, true])
    expect(route.steps[2].lanePlan).toBeUndefined()
  })

  test('runs a walk on to it along its centreline', () => {
    const drive = lanedDrive()
    const start = cityDrive().geometry![0]
    const walk: NavSegmentInput = { mode: 'walking', geometry: polyline([[180, 100]], start).reverse() }
    const route = buildNavRoute([walk, drive])
    expect(route.laneLine).not.toBeNull()
    expect(pointAt(route.laneLine!, 50)).toEqual(pointAt(route, 50))
    expect(route.laneLine!.cumulative.at(-1)).toBeCloseTo(route.length, 3)
  })

  test('is left out unless every driven segment has one', () => {
    expect(buildNavRoute([lanedDrive(), cityDrive()]).laneLine).toBeNull()
    expect(buildNavRoute([cityDrive()]).drivingSide).toBe('right')
    expect(buildNavRoute([{ ...cityDrive(), drivingSide: 'left' }]).drivingSide).toBe('left')
  })
})
