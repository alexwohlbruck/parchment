import { describe, expect, test } from 'bun:test'
import { attachHazards, isPremiumHazard, routeHazards } from './route-hazards'
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
})

describe('tiers', () => {
  test('safety kinds are never premium', () => {
    for (const kind of ['crosswalk', 'uncontrolled_crossing', 'rail_crossing', 'ford', 'steep_grade', 'steps', 'sharp_curve', 'shared_space', 'tunnel', 'traffic_signals'] as const) {
      expect(isPremiumHazard(kind)).toBe(false)
    }
  })

  test('premium kinds are stripped for everyone else, including nested segments', () => {
    const rough = straight([{ surface: 'gravel' }, { crossing: 'marked' }])
    const trip = [{ ...straight(), details: { multimodalSegments: [rough] } }] as any[]
    attachHazards(trip, { premium: false })
    expect(trip[0].details.multimodalSegments[0].hazards.map((h: any) => h.kind)).toEqual(['crosswalk'])
    attachHazards(trip, { premium: true })
    expect(trip[0].details.multimodalSegments[0].hazards.map((h: any) => h.kind)).toEqual(['rough_surface', 'crosswalk'])
  })
})
