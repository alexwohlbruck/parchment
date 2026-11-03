import { describe, expect, test } from 'vitest'
import { distanceMeters, projectLatLng } from '@/lib/map/movement-interpolation'
import { synthesizeDrive } from '@/dev/gpx-simulator/route-drive'
import { FixNoise, REALISTIC_FIX_MODEL } from '@/dev/gpx-simulator/fix-model'
import { pointAtTime } from '@/dev/gpx-simulator/gpx-parser'
import { buildNavRoute, pointAt } from './nav-route'
import { GuidanceEngine } from './guidance-engine'
import { drawnPoint } from './route-line'
import { cityDrive, polyline } from './test-routes'
import { createRandom } from '@/dev/gpx-simulator/fix-model'
import { syntheticAcceleration } from '@/dev/gpx-simulator/motion-synth'

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

  test('keeps the puck on the route line as drawn, half a lane right of a driven centreline', () => {
    const { engine, route } = replay(3)
    const puck = engine.sample(1e6)!
    expect(puck.snapped).toBe(true)
    expect(distanceMeters(puck.position, drawnPoint(route, puck.s))).toBeLessThan(0.01)
    expect(distanceMeters(puck.position, pointAt(route, puck.s))).toBeCloseTo(1.8, 1)
  })

  test('rides the lane line where the route has one', () => {
    const centre = buildNavRoute([{ mode: 'cycling', geometry: polyline([[0, 300]]) }])
    const coordinates = centre.points.map(p => projectLatLng(p, 3, 90, 1)).map(p => [p.lng, p.lat] as [number, number])
    const route = buildNavRoute([{ mode: 'cycling', geometry: centre.points, laneGeometry: { coordinates, measures: Array.from(centre.cumulative) } }])
    const engine = new GuidanceEngine(route)
    for (let t = 1; t <= 10; t++) engine.pushFix({ t, position: pointAt(route, 10 * t), accuracy: 5, speed: 10, heading: 0 })
    const puck = engine.sample(10)!
    expect(distanceMeters(puck.position, pointAt(route.laneLine!, puck.s))).toBeLessThan(0.01)
    expect(distanceMeters(puck.position, pointAt(route, puck.s))).toBeCloseTo(3, 0)
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

  test('snaps to a new route after a reroute, keeping its speed', () => {
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
    const detour = buildNavRoute([{ mode: 'driving', geometry: polyline([[270, 300], [0, 500]], position) }])
    engine.setRoute(detour)
    engine.pushFix({ t: 17, position: pointAt(detour, 15), accuracy: 5, speed: 15, heading: 270 })
    const puck = engine.sample(17.5)!
    expect(puck.snapped).toBe(true)
    expect(puck.s).toBeGreaterThan(5)
    expect(puck.speed).toBeGreaterThan(5)
  })

  test('picks the vehicle up far along the route when it comes out of a tunnel', () => {
    const route = buildNavRoute([{ mode: 'transit', geometry: polyline([[0, 4000]]) }])
    const engine = new GuidanceEngine(route)
    for (let t = 1; t <= 20; t++) engine.pushFix({ t, position: pointAt(route, 10 * t), accuracy: 5, speed: 10, heading: 0 })
    for (let t = 200; t <= 203; t++) {
      engine.pushFix({ t, position: pointAt(route, 2000 + 10 * (t - 200)), accuracy: 8, speed: 10, heading: 0 })
      expect(engine.isOffRoute).toBe(false)
    }
    expect(engine.sample(203.5)?.s).toBeGreaterThan(2000)
  })

  test('holds the puck where it is pinned until released', () => {
    const route = buildNavRoute([cityDrive()])
    const engine = new GuidanceEngine(route)
    for (let t = 1; t <= 10; t++) engine.pushFix({ t, position: pointAt(route, 10 * t), accuracy: 5, speed: 10, heading: 0 })
    engine.hold(40)
    expect(engine.sample(12)).toMatchObject({ s: 40, speed: 0, snapped: true })
    engine.hold(null)
    expect(engine.sample(12)!.s).toBeGreaterThan(100)
  })
})

describe('GuidanceEngine when the GPS signal degrades', () => {
  const WALK = 1.4
  const walkingRoute = () => buildNavRoute([{ ...cityDrive(), mode: 'walking' }])
  type Route = ReturnType<typeof walkingRoute>

  function walkTo(engine: GuidanceEngine, route: Route, until: number, from = 1) {
    for (let t = from; t <= until; t++) {
      engine.pushFix({ t, position: pointAt(route, WALK * t), accuracy: 5, speed: WALK, heading: null })
    }
  }

  function steps(engine: GuidanceEngine, from: number, to: number, speed: number, seed = 3) {
    const random = createRandom(seed)
    for (let t = from; t < to; t += 0.02) {
      engine.pushMotion({ t, accelWithGravity: syntheticAcceleration(t, speed, random), rotationRate: { x: 0, y: 0, z: 0 } })
    }
  }

  function scattered(route: Route, t: number, s: number, random: () => number) {
    const accuracy = 30 + random() * 470
    const along = Math.min(route.length, Math.max(0, s + (random() * 2 - 0.5) * 600))
    const position = projectLatLng(pointAt(route, along), random() * accuracy, random() * 360, 1)
    return { t, position, accuracy, speed: random() < 0.5 ? null : random() * 4, heading: null }
  }

  test('coarse fixes scattered hundreds of metres never fling the puck', () => {
    const route = walkingRoute()
    const engine = new GuidanceEngine(route)
    steps(engine, 0, 120, WALK)
    walkTo(engine, route, 60)
    const random = createRandom(11)
    let furthest = 0
    for (let t = 61; t <= 120; t++) {
      engine.pushFix(scattered(route, t, WALK * t, random))
      for (let f = 0; f < 4; f++) furthest = Math.max(furthest, engine.sample(t + f / 4)!.s - WALK * (t + f / 4))
    }
    expect(furthest).toBeLessThan(40)
    expect(Math.abs(engine.sample(120)!.s - WALK * 120)).toBeLessThan(30)
  })

  test('a run of agreeing ghost fixes far ahead is not a relocation', () => {
    const route = walkingRoute()
    const engine = new GuidanceEngine(route)
    walkTo(engine, route, 60)
    let furthest = 0
    for (let t = 61; t <= 70; t++) {
      if (t <= 64) engine.pushFix({ t, position: pointAt(route, WALK * t + 150), accuracy: 20, speed: WALK, heading: null })
      else walkTo(engine, route, t, t)
      furthest = Math.max(furthest, engine.sample(t + 0.5)!.s - WALK * (t + 0.5))
    }
    expect(furthest).toBeLessThan(15)
  })

  test('relocates once good fixes keep agreeing somewhere out of reach', () => {
    const route = walkingRoute()
    const engine = new GuidanceEngine(route)
    walkTo(engine, route, 30)
    for (let t = 31; t <= 40; t++) {
      engine.pushFix({ t, position: pointAt(route, 900 + WALK * t), accuracy: 8, speed: WALK, heading: null })
    }
    expect(engine.sample(40)!.s).toBeGreaterThan(900)
  })

  test('marks the puck estimated while lost, with uncertainty that grows', () => {
    const route = buildNavRoute([cityDrive()])
    const engine = new GuidanceEngine(route)
    for (let t = 1; t <= 10; t++) engine.pushFix({ t, position: pointAt(route, 10 * t), accuracy: 5, speed: 10, heading: 0 })
    expect(engine.sample(11)!.estimated).toBe(false)
    expect(engine.sample(20)!.estimated).toBe(true)
    const early = engine.diagnostics.sigma
    engine.sample(40)
    expect(engine.diagnostics.sigma).toBeGreaterThan(early)
    engine.pushFix({ t: 41, position: pointAt(route, 380), accuracy: 5, speed: 10, heading: 0 })
    expect(engine.sample(41)!.estimated).toBe(false)
  })

  test('steps hold the puck to the walk while canyon fixes drift ahead', () => {
    const route = walkingRoute()
    const engine = new GuidanceEngine(route)
    steps(engine, 0, 100, WALK)
    walkTo(engine, route, 60)
    for (let t = 61; t <= 100; t++) {
      const drift = 3 * (t - 60)
      engine.pushFix({ t, position: pointAt(route, WALK * t + drift), accuracy: 30 + (t % 4) * 5, speed: WALK + 3, heading: null })
    }
    expect(engine.sample(100)!.s - WALK * 100).toBeLessThan(40)
  })

  test('waits for a fix at the next stop of a dead-reckoned walk', () => {
    const route = walkingRoute()
    const engine = new GuidanceEngine(route)
    steps(engine, 0, 600, WALK)
    walkTo(engine, route, 400)
    expect(engine.sample(600)!.s).toBeLessThanOrEqual(600 + 15)
  })

  test('after a gap, a fix beyond walking reach does not move the puck there', () => {
    const route = walkingRoute()
    const engine = new GuidanceEngine(route)
    walkTo(engine, route, 60)
    engine.pushFix({ t: 120, position: pointAt(route, 1450), accuracy: 40, speed: 1, heading: null })
    engine.pushFix({ t: 121, position: pointAt(route, 1452), accuracy: 40, speed: 1, heading: null })
    expect(engine.sample(121)!.s).toBeLessThan(WALK * 121 + 2.5 * 60)
  })

  test('steps carry the puck through a long gap', () => {
    const route = walkingRoute()
    const engine = new GuidanceEngine(route)
    steps(engine, 0, 150, WALK)
    walkTo(engine, route, 60)
    expect(Math.abs(engine.sample(150)!.s - WALK * 150)).toBeLessThan(15)
  })

  test('standing still holds the puck while there is no fix', () => {
    const route = walkingRoute()
    const engine = new GuidanceEngine(route)
    steps(engine, 0, 60, WALK)
    walkTo(engine, route, 60)
    steps(engine, 60, 120, 0)
    expect(engine.sample(120)!.s - WALK * 60).toBeLessThan(8)
  })

  test('coasting without sensors stops short of the next maneuver', () => {
    const route = buildNavRoute([cityDrive()])
    const engine = new GuidanceEngine(route)
    for (let t = 1; t <= 30; t++) engine.pushFix({ t, position: pointAt(route, 15 * t), accuracy: 5, speed: 15, heading: 0 })
    for (let t = 30; t <= 150; t += 5) expect(engine.sample(t)!.s).toBeLessThanOrEqual(600 + 15)
  })
})
