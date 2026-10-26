import { describe, expect, test } from 'vitest'
import { distanceMeters } from '@/lib/map/movement-interpolation'
import { buildNavRoute } from './nav-route'
import { frameCamera } from './camera-framing'
import type { PuckState } from './guidance-engine'
import {
  freeModeFor,
  HazardWatch,
  horizonSegment,
  horizonTarget,
  needsHorizon,
  roamProgress,
  straightSegment,
} from './free-roam'
import { cityDrive } from './test-routes'
import type { RouteHazard } from '@/types/directions.types'

const puckAt = (s: number, snapped = true, speed = 12): PuckState => ({
  position: { lat: 0, lng: 0 },
  bearing: 0,
  s,
  speed,
  snapped,
  stepIndex: 0,
})

describe('freeModeFor', () => {
  test('maps street modes and rejects the rest', () => {
    expect(freeModeFor('biking')).toBe('cycling')
    expect(freeModeFor('walking')).toBe('walking')
    expect(freeModeFor('transit')).toBeNull()
  })
})

describe('horizonTarget', () => {
  test('looks further ahead the faster the mode', () => {
    const from = { lat: 35, lng: -80 }
    expect(distanceMeters(from, horizonTarget(from, 90, 'driving'))).toBeCloseTo(3000, -1)
    expect(distanceMeters(from, horizonTarget(from, 90, 'walking'))).toBeCloseTo(500, -1)
  })
})

describe('horizonSegment', () => {
  test("the path's turns no longer pull the camera in", () => {
    const planned = buildNavRoute([cityDrive()])
    const ahead = buildNavRoute([horizonSegment(cityDrive(), 'driving')])
    const frame = (route: typeof planned) =>
      frameCamera({ route, puck: puckAt(560), mode: 'follow-3d', bearingMode: 'straight', travelMode: 'driving', visibleHeight: 800 })
    expect(frame(planned).secondsToManeuver).toBeLessThan(Infinity)
    expect(frame(ahead).secondsToManeuver).toBe(Infinity)
    expect(ahead.steps).toHaveLength(planned.steps.length)
  })
})

describe('needsHorizon', () => {
  const horizon = buildNavRoute([cityDrive()])

  test('replans near the end of the path or once off it', () => {
    expect(needsHorizon(horizon, puckAt(200), 'driving')).toBe(false)
    expect(needsHorizon(horizon, puckAt(600), 'driving')).toBe(true)
    expect(needsHorizon(horizon, puckAt(200, false), 'driving')).toBe(true)
    expect(needsHorizon(null, null, 'driving')).toBe(true)
  })

  test('replans when the mode changes', () => {
    expect(needsHorizon(horizon, puckAt(200), 'walking')).toBe(true)
  })
})

describe('straightSegment', () => {
  test('builds a followable line with no road on it', () => {
    const route = buildNavRoute([straightSegment({ lat: 35, lng: -80 }, 0, 'walking')])
    expect(route.length).toBeCloseTo(500, -1)
    expect(route.steps).toEqual([])
  })
})

describe('roamProgress', () => {
  test('carries the speed limit and nothing about an end', () => {
    const horizon = buildNavRoute([cityDrive()])
    expect(roamProgress(horizon, puckAt(100))).toMatchObject({ speedLimitKmh: 50, next: null, remainingMeters: 0 })
    expect(roamProgress(horizon, puckAt(100, false)).speedLimitKmh).toBeNull()
  })
})

describe('HazardWatch', () => {
  const crossing = (startDistance: number): RouteHazard => ({
    kind: 'rail_crossing',
    severity: 'high',
    startDistance,
    coordinate: { lat: 35.23, lng: -80.84 },
  })

  test('raises a hazard once even when the path is replanned', () => {
    const watch = new HazardWatch()
    const first = buildNavRoute([{ ...cityDrive(), hazards: [crossing(250)] }])
    const replanned = buildNavRoute([{ ...cityDrive(), hazards: [crossing(150)] }])
    expect(watch.update(first, puckAt(200))?.hazard.kind).toBe('rail_crossing')
    expect(watch.update(first, puckAt(210))).toBeNull()
    expect(watch.update(replanned, puckAt(100))).toBeNull()
  })

  test('stays quiet off the path', () => {
    const route = buildNavRoute([{ ...cityDrive(), hazards: [crossing(250)] }])
    expect(new HazardWatch().update(route, puckAt(200, false))).toBeNull()
  })
})
