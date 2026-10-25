import { describe, expect, test } from 'vitest'
import { distanceMeters } from '@/lib/map/movement-interpolation'
import {
  bearingAt,
  buildNavRoute,
  edgeAt,
  pointAt,
  routeAhead,
  segmentAt,
  smoothedBearingAt,
  stepIndexAt,
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
