import { describe, expect, test } from 'bun:test'
import { routeMetrics } from './route-metrics'

const instruction = (modifier: string | undefined, streetName: string, distance: number) =>
  ({ type: 'turn', text: '', coordinate: { lat: 0, lng: 0 }, distance, duration: 0, modifier, streetName }) as never

describe('routeMetrics', () => {
  const metrics = routeMetrics({
    duration: 600,
    distance: 1000,
    instructions: [instruction(undefined, 'Elm St', 700), instruction('left', 'Oak Ave', 200), instruction('slight-right', 'Pine Rd', 100)],
    edgeSegments: [
      { startDistance: 0, endDistance: 400, roadClass: 'cycleway' },
      { startDistance: 400, endDistance: 500, roadClass: 'residential', cycleway: 'track' },
      { startDistance: 500, endDistance: 800, roadClass: 'primary', cycleway: 'lane', crossing: 'TRAFFIC_SIGNALS' },
      { startDistance: 800, endDistance: 1000, roadClass: 'residential', crossing: 'MISSING' },
    ],
  })

  test('counts real turns only', () => expect(metrics.turns).toBe(1))
  test('separated cycling counts as protected, painted lanes do not', () => expect(metrics.protectedShare).toBeCloseTo(0.5))
  test('measures major roads and crossings', () => {
    expect(metrics.majorRoadShare).toBeCloseTo(0.3)
    expect(metrics.crossings).toBe(1)
  })
  test('names the street carrying most of it', () => expect(metrics.via).toBe('Elm St'))
  test('reads GraphHopper\'s lowercase crossing values', () => {
    const edges = [{ startDistance: 0, endDistance: 10, crossing: 'missing' }, { startDistance: 10, endDistance: 20, crossing: 'marked' }]
    expect(routeMetrics({ duration: 10, distance: 20, edgeSegments: edges }).crossings).toBe(1)
  })
})
