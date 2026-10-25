import { describe, expect, test } from 'vitest'
import { distanceMeters, projectLatLng } from '@/lib/map/movement-interpolation'
import { synthesizeDrive } from '@/dev/gpx-simulator/route-drive'
import { FixNoise, REALISTIC_FIX_MODEL } from '@/dev/gpx-simulator/fix-model'
import { pointAtTime } from '@/dev/gpx-simulator/gpx-parser'
import { buildNavRoute, pointAt } from './nav-route'
import { GuidanceEngine } from './guidance-engine'
import { cityDrive } from './test-routes'

function replay(seed: number) {
  const route = buildNavRoute([cityDrive()])
  const track = synthesizeDrive(route, 'driving', 0, seed)
  const noise = new FixNoise(REALISTIC_FIX_MODEL, seed)
  const engine = new GuidanceEngine(route)
  const end = track[track.length - 1].time / 1000
  const errors: number[] = []
  let lastS = -Infinity
  let maxStepBack = 0

  for (let fixT = 1; fixT <= end; fixT++) {
    const truth = pointAtTime(track, fixT * 1000)!
    const noisy = noise.next(truth, 1)
    if (noisy) {
      engine.pushFix(
        { t: fixT, position: noisy, accuracy: noisy.accuracy, speed: noisy.speed, heading: noisy.heading },
        fixT + 0.3,
      )
    }
    for (let frame = 0; frame < 60; frame++) {
      const t = fixT + 0.3 + frame / 60
      const puck = engine.sample(t)
      if (!puck) continue
      maxStepBack = Math.max(maxStepBack, lastS - puck.s)
      lastS = puck.s
      const actual = pointAtTime(track, t * 1000)
      if (actual) errors.push(distanceMeters(puck.position, actual))
    }
  }
  errors.sort((a, b) => a - b)
  return { errors, maxStepBack, route, engine }
}

describe('GuidanceEngine', () => {
  test.each([1, 7, 42])('follows a noisy drive closely and never runs backwards (seed %i)', seed => {
    const { errors, maxStepBack } = replay(seed)
    const median = errors[Math.floor(errors.length / 2)]
    const p95 = errors[Math.floor(errors.length * 0.95)]
    expect(median).toBeLessThan(4)
    expect(p95).toBeLessThan(12)
    expect(maxStepBack).toBe(0)
  })

  test('keeps the puck on the route line', () => {
    const { engine, route } = replay(3)
    const puck = engine.sample(1e6)!
    expect(puck.snapped).toBe(true)
    expect(distanceMeters(puck.position, pointAt(route, puck.s))).toBeLessThan(0.01)
  })

  test('leaves the route after sustained fixes away from it', () => {
    const route = buildNavRoute([cityDrive()])
    const engine = new GuidanceEngine(route)
    for (let t = 1; t <= 10; t++) {
      engine.pushFix({ t, position: pointAt(route, 10 * t), accuracy: 5, speed: 10, heading: 0 })
    }
    let position = pointAt(route, 100)
    for (let t = 11; t <= 16; t++) {
      position = projectLatLng(position, 15, 270, 1)
      engine.pushFix({ t, position, accuracy: 5, speed: 15, heading: 270 })
    }
    expect(engine.isOffRoute).toBe(true)
    expect(engine.sample(16)?.snapped).toBe(false)
  })
})
