import { describe, expect, test } from 'bun:test'
import { isPremiumHazard, routeHazards } from './route-hazards'
import type { Coordinate, RouteEdgeSegment } from '../types/unified-routing.types'

/** A straight 1 km line north, with optional edge attributes along it. */
function straight(edges: Partial<RouteEdgeSegment>[] = [], mode = 'driving') {
  const geometry: Coordinate[] = Array.from({ length: 101 }, (_, i) => ({ lat: 40 + i * 0.00009, lng: -74 }))
  const edgeSegments = edges.map((e, i) => ({ startDistance: i * 100, endDistance: i * 100 + 100, ...e }))
  return { mode, geometry, edgeSegments }
}

describe('routeHazards', () => {
  test('crosswalks on a driven road are high-severity for drivers', () => {
    const hazards = routeHazards(straight([{ crossing: 'MARKED' }, { crossing: 'TRAFFIC_SIGNALS' }]))
    expect(hazards.map((h) => [h.kind, h.severity])).toEqual([
      ['crosswalk', 'high'],
      ['traffic_signals', 'low'],
    ])
  })

  test('an uncontrolled crossing is its own warning on foot', () => {
    expect(routeHazards(straight([{ crossing: 'uncontrolled' }], 'walking'))[0].kind).toBe('uncontrolled_crossing')
  })

  test('rail crossings warn every mode', () => {
    for (const mode of ['walking', 'biking', 'driving']) {
      expect(routeHazards(straight([{ crossing: 'railway' }], mode))[0]).toMatchObject({ kind: 'rail_crossing', severity: 'high' })
    }
  })

  test('one crossing split across two edges reads as one', () => {
    const route = straight([{ crossing: 'railway' }])
    route.edgeSegments.push({ startDistance: 15, endDistance: 40, crossing: 'railway' } as any)
    expect(routeHazards(route).filter((h) => h.kind === 'rail_crossing')).toHaveLength(1)
  })

  /** Point crossings at the given distances along the straight line. */
  const crossings = (crossing: string, at: number[]) => ({
    ...straight(),
    edgeSegments: at.map((d) => ({ startDistance: d, endDistance: d + 5, crossing })),
  })

  test('the signalled crosswalks either side of a junction read as one light at its centre', () => {
    const lights = routeHazards(crossings('traffic_signals', [100, 140, 300])).filter((h) => h.kind === 'traffic_signals')
    expect(lights.map((h) => h.startDistance)).toEqual([120, 300])
    expect(lights[0].coordinate.lat).toBeCloseTo(40 + 120 / 111195 * 1, 4)
  })

  test('lights at neighbouring junctions stay apart', () => {
    expect(routeHazards(crossings('traffic_signals', [100, 160])).filter((h) => h.kind === 'traffic_signals')).toHaveLength(2)
  })

  test('plain crosswalks either side of a junction both stay', () => {
    expect(routeHazards(crossings('marked', [100, 140]))).toHaveLength(2)
  })

  test('adjacent edges of one stretch merge', () => {
    const hazards = routeHazards(straight([{ roadEnvironment: 'tunnel' }, { roadEnvironment: 'tunnel' }, {}]))
    expect(hazards).toHaveLength(1)
    expect(hazards[0]).toMatchObject({ kind: 'tunnel', startDistance: 0, endDistance: 200 })
  })

  /** 1 km north climbing `grade` percent, plus optional per-point elevation noise. */
  const climb = (mode: string, grade: number, noise: (i: number) => number = () => 0) => ({
    mode,
    geometry: Array.from({ length: 101 }, (_, i) => ({ lat: 40 + i * 0.00009, lng: -74, elevation: 20 + i * 10 * (grade / 100) + noise(i) })),
  })

  test('sustained grades use a per-mode threshold', () => {
    expect(routeHazards(climb('biking', 8)).map((h) => h.kind)).toEqual(['steep_grade'])
    expect(routeHazards(climb('walking', 8))).toHaveLength(0)
    expect(routeHazards(climb('driving', 20))).toHaveLength(0)
  })

  test('missing elevation (reported as 0) is not a climb', () => {
    const tunnel = climb('biking', 0)
    tunnel.geometry.slice(0, 10).forEach((p) => (p.elevation = 0))
    expect(routeHazards(tunnel)).toHaveLength(0)
  })

  test('surface-model noise on a flat street is not a grade', () => {
    const buildings = (i: number) => (i % 6 < 3 ? 25 : 0)
    expect(routeHazards(climb('walking', 0, buildings))).toHaveLength(0)
  })

  test('a sharp bend away from any instruction is a curve', () => {
    const geometry: Coordinate[] = [
      ...Array.from({ length: 30 }, (_, i) => ({ lat: 40 + i * 0.00009, lng: -74 })),
      ...Array.from({ length: 30 }, (_, i) => ({ lat: 40 + 29 * 0.00009, lng: -74 + (i + 1) * 0.00012 })),
    ]
    const curves = routeHazards({ mode: 'driving', geometry }).filter((h) => h.kind === 'sharp_curve')
    expect(curves).toHaveLength(1)
    const atTurn = routeHazards({ mode: 'driving', geometry, instructions: [{ type: 'turn', text: '', coordinate: geometry[29], distance: 0, duration: 0 }] })
    expect(atTurn.filter((h) => h.kind === 'sharp_curve')).toHaveLength(0)
  })

  test('a climb with an elevation gap and a bend reads at fixed distances', () => {
    const geometry: Coordinate[] = Array.from({ length: 301 }, (_, i) => ({
      lat: 40 + Math.min(i, 150) * 0.00009,
      lng: -74 + Math.max(0, i - 150) * 0.00012,
      elevation: i >= 40 && i < 50 ? 0 : 20 + (i > 60 && i < 120 ? (i - 60) * 1.2 : i >= 120 ? 72 - (i - 120) * 0.2 : 0),
    }))
    expect(routeHazards({ mode: 'biking', geometry }).map((h) => [h.kind, h.severity, h.startDistance, h.endDistance, h.variant])).toEqual([
      ['steep_grade', 'high', 600, 1250, '12'],
      ['sharp_curve', 'medium', 1505, undefined, '71'],
    ])
  })

  test('a very long segment stays fast', () => {
    const geometry: Coordinate[] = Array.from({ length: 50_000 }, (_, i) => ({ lat: 35 + i * 0.0002, lng: -80 + Math.sin(i / 50) * 0.01, elevation: 100 + Math.sin(i / 200) * 80 }))
    const instructions = Array.from({ length: 2000 }, (_, i) => ({ type: 'turn', text: '', coordinate: geometry[i * 25], distance: 0, duration: 0 }))
    const started = performance.now()
    for (const mode of ['walking', 'biking', 'driving']) routeHazards({ mode, geometry, instructions })
    expect(performance.now() - started).toBeLessThan(3000)
  }, 20_000)
})

describe('with tagged hazards', () => {
  const light = (startDistance: number) => ({ kind: 'traffic_signals' as const, severity: 'low' as const, startDistance, coordinate: { lat: 40, lng: -74 } })

  test("real lights replace the signalled crossings a driver would otherwise get", () => {
    const route = straight([{ crossing: 'TRAFFIC_SIGNALS' }, {}, { crossing: 'TRAFFIC_SIGNALS' }])
    const lights = routeHazards(route, { points: [light(260)] }).filter((h) => h.kind === 'traffic_signals')
    expect(lights.map((h) => h.startDistance)).toEqual([260])
  })

  test('on foot the signalled crossing is the light that matters, and stays', () => {
    const route = straight([{ crossing: 'TRAFFIC_SIGNALS' }], 'walking')
    expect(routeHazards(route, { points: [light(500)] }).filter((h) => h.kind === 'traffic_signals')).toHaveLength(2)
  })

  test('without an answer from barrelman the crossings stand in for lights', () => {
    expect(routeHazards(straight([{ crossing: 'TRAFFIC_SIGNALS' }]), { points: null })[0].kind).toBe('traffic_signals')
  })

  test('bridges warn of ice only in a frost, and not on foot', () => {
    const bridge = (mode: string) => straight([{}, { roadEnvironment: 'bridge' }], mode)
    expect(routeHazards(bridge('driving')).some((h) => h.kind === 'icy_bridge')).toBe(false)
    expect(routeHazards(bridge('driving'), { freezing: true }).find((h) => h.kind === 'icy_bridge')).toMatchObject({ startDistance: 100, endDistance: 200 })
    expect(routeHazards(bridge('walking'), { freezing: true }).some((h) => h.kind === 'icy_bridge')).toBe(false)
  })
})

describe('tiers', () => {
  test('safety kinds are never premium', () => {
    for (const kind of ['crosswalk', 'uncontrolled_crossing', 'rail_crossing', 'ford', 'steep_grade', 'steps', 'sharp_curve', 'shared_space', 'tunnel', 'traffic_signals',
      'stop', 'give_way', 'tram_tracks', 'tram_crossing', 'unlit', 'flood_prone', 'icy_bridge', 'school_zone', 'no_sidewalk', 'low_clearance', 'hazard'] as const) {
      expect(isPremiumHazard(kind)).toBe(false)
    }
  })
})
