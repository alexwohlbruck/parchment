import { describe, test, expect } from 'vitest'
import {
  projectVehicleOnRoute,
  computeIsForward,
  projectOntoShape,
} from '@/lib/transit/route-projection'
import type { RouteDetailStop } from '@/types/transit.types'
import type { TransitVehiclePosition } from '@/types/multimodal.types'

/** Four stops on a due-north line, 1000m apart in the route's own metric. */
const stops: RouteDetailStop[] = [
  { stopId: 'a', stopName: 'A', lat: 0, lng: 0, distanceAlongRoute: 0 },
  { stopId: 'b', stopName: 'B', lat: 0.01, lng: 0, distanceAlongRoute: 1000 },
  { stopId: 'c', stopName: 'C', lat: 0.02, lng: 0, distanceAlongRoute: 2000 },
  { stopId: 'd', stopName: 'D', lat: 0.03, lng: 0, distanceAlongRoute: 3000 },
]

function vehicleAt(lat: number, lng: number, bearing?: number): TransitVehiclePosition {
  return {
    vehicleId: 'v1',
    position: { lat, lng },
    bearing,
  } as TransitVehiclePosition
}

describe('computeIsForward', () => {
  test('assumes forward when the feed omits bearing', () => {
    expect(computeIsForward(undefined, stops[0], stops[1])).toBe(true)
  })

  test('bearing along stop order is forward', () => {
    expect(computeIsForward(0, stops[0], stops[1])).toBe(true)
  })

  test('bearing against stop order is not forward', () => {
    expect(computeIsForward(180, stops[0], stops[1])).toBe(false)
  })

  test('treats the 90 degree boundary as not forward', () => {
    expect(computeIsForward(90, stops[0], stops[1])).toBe(false)
  })

  test('wraps around 360 rather than reading it as a large difference', () => {
    expect(computeIsForward(359, stops[0], stops[1])).toBe(true)
  })
})

describe('projectOntoShape', () => {
  test('falls back to the nearest stop when there is no shape', () => {
    expect(projectOntoShape(0.0201, 0, null, stops)).toBe(2000)
  })

  test('rescales shape distance onto the stop distance metric', () => {
    const shape: [number, number][] = [
      [0, 0],
      [0, 0.03],
    ]
    // Halfway along the shape is halfway along the stop range.
    expect(projectOntoShape(0.015, 0, shape, stops)).toBeCloseTo(1500, 0)
  })

  test('clamps a point beyond the shape to its end', () => {
    const shape: [number, number][] = [
      [0, 0],
      [0, 0.03],
    ]
    expect(projectOntoShape(0.05, 0, shape, stops)).toBeCloseTo(3000, 0)
  })
})

describe('projectVehicleOnRoute', () => {
  test('returns null for a route too short to have a segment', () => {
    expect(projectVehicleOnRoute(vehicleAt(0, 0), stops.slice(0, 1))).toBeNull()
  })

  const shape: [number, number][] = [
    [0, 0],
    [0, 0.03],
  ]

  test('snaps to the nearest stop when the route has no shape', () => {
    const result = projectVehicleOnRoute(vehicleAt(0.015, 0, 0), stops)
    expect(result).not.toBeNull()
    expect(result!.distanceAlongRoute).toBe(1000)
    expect(result!.fractionBetweenStops).toBe(0)
  })

  test('places a vehicle between the stops that bracket it', () => {
    const result = projectVehicleOnRoute(vehicleAt(0.015, 0, 0), stops, shape)
    expect(result).not.toBeNull()
    expect(result!.nearestStopIndex).toBe(2)
    expect(result!.fractionBetweenStops).toBeCloseTo(0.5, 2)
    expect(result!.isForwardDirection).toBe(true)
  })

  test('reports a route fraction spanning the whole stop list', () => {
    expect(projectVehicleOnRoute(vehicleAt(0, 0, 0), stops, shape)!.routeFraction).toBeCloseTo(0, 5)
    expect(projectVehicleOnRoute(vehicleAt(0.03, 0, 0), stops, shape)!.routeFraction).toBeCloseTo(1, 5)
  })

  test('keeps the route fraction within 0-1 for a vehicle past the last stop', () => {
    const result = projectVehicleOnRoute(vehicleAt(0.09, 0, 0), stops, shape)!
    expect(result.routeFraction).toBeLessThanOrEqual(1)
    expect(result.routeFraction).toBeGreaterThanOrEqual(0)
  })

  test('detects a vehicle running the route backwards', () => {
    expect(projectVehicleOnRoute(vehicleAt(0.015, 0, 180), stops, shape)!.isForwardDirection).toBe(false)
  })
})
