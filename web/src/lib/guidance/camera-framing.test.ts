import { describe, expect, test } from 'vitest'
import { buildNavRoute, pointAt, smoothedBearingAt, stepIndexAt, type NavRoute } from './nav-route'
import { DEFAULT_CAMERA_TUNING, PUCK_FOOTROOM, frameCamera, puckFocal, type FramingInput } from './camera-framing'
import type { PuckState } from './guidance-engine'
import { cityDrive, polyline } from './test-routes'
import { angleDelta } from './spring'

function puckAt(route: NavRoute, s: number, speed: number): PuckState {
  return {
    position: pointAt(route, s),
    bearing: smoothedBearingAt(route, s, 5),
    s,
    speed,
    snapped: true,
    stepIndex: stepIndexAt(route, s),
  }
}

function frame(route: NavRoute, s: number, speed: number, overrides: Partial<FramingInput> = {}) {
  return frameCamera({
    route,
    puck: puckAt(route, s, speed),
    mode: 'follow-3d',
    bearingMode: 'straight',
    travelMode: 'driving',
    visibleHeight: 600,
    ...overrides,
  })
}

describe('frameCamera', () => {
  const straight = buildNavRoute([{ mode: 'driving', geometry: polyline([[0, 5000]]) }])
  const city = buildNavRoute([cityDrive()])

  test('shows more road at highway speed than in town', () => {
    expect(frame(straight, 1000, 30).zoom).toBeLessThan(frame(straight, 1000, 10).zoom - 0.5)
  })

  test('a stop at a light does not zoom all the way in', () => {
    const stopped = frame(city, 300, 0)
    const rolling = frame(city, 300, 10)
    expect(Math.abs(stopped.zoom - rolling.zoom)).toBeLessThan(0.5)
  })

  test('zooms in and flattens smoothly approaching a turn', () => {
    const far = frame(city, 300, 12)
    const near = frame(city, 560, 12)
    const nearer = frame(city, 590, 12)
    expect(near.zoom).toBeGreaterThan(far.zoom)
    expect(nearer.zoom).toBeGreaterThanOrEqual(near.zoom)
    expect(near.pitch).toBeLessThan(far.pitch)
    expect(nearer.pitch).toBeLessThan(near.pitch)
  })

  test('framing eases in without a jump at the edge of the maneuver zone', () => {
    const samples = Array.from({ length: 60 }, (_, i) => frame(city, 300 + i * 5, 12).zoom)
    const jumps = samples.slice(1).map((z, i) => Math.abs(z - samples[i]))
    expect(Math.max(...jumps)).toBeLessThan(0.15)
  })

  test('north up keeps the map north and centres the puck', () => {
    const north = frame(city, 800, 12, { mode: 'north-up' })
    expect(north.bearing).toBe(0)
    expect(north.pitch).toBe(0)
    expect(north.focal).toBe(0.5)
  })

  test('look ahead turns toward the upcoming bend, within its clamp', () => {
    const lookAhead = frame(city, 570, 12, { bearingMode: 'look-ahead' })
    const straightOn = frame(city, 570, 12, { bearingMode: 'straight' })
    expect(angleDelta(straightOn.bearing, lookAhead.bearing)).toBeGreaterThan(10)
    expect(Math.abs(angleDelta(straightOn.bearing, lookAhead.bearing))).toBeLessThanOrEqual(45)
  })

  test('walking frames tighter than driving', () => {
    expect(frame(straight, 1000, 1.4, { travelMode: 'walking' }).zoom).toBeGreaterThan(
      frame(straight, 1000, 1.4).zoom,
    )
  })
})

describe('puckFocal', () => {
  test('sits low on a tall phone map', () => {
    expect(puckFocal('follow-3d', DEFAULT_CAMERA_TUNING, 700)).toBe(DEFAULT_CAMERA_TUNING.focal)
  })

  test('rises on a short map so the road name still fits below', () => {
    const focal = puckFocal('heading-up', DEFAULT_CAMERA_TUNING, 300)
    expect(300 * (1 - focal)).toBeCloseTo(PUCK_FOOTROOM)
  })

  test('centres north-up', () => {
    expect(puckFocal('north-up', DEFAULT_CAMERA_TUNING, 700)).toBe(0.5)
  })
})
