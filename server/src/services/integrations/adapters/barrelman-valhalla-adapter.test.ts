/**
 * Unit tests for the Barrelman→Valhalla routing adapter.
 *
 * Barrelman proxies Valhalla transparently, so the payload is a plain Valhalla
 * response — meaning the same km→m ×1000 conversion applies to distances while
 * times are already seconds. The proxy adds two things this adapter is
 * responsible for surfacing: per-vertex ELEVATION zipped onto the geometry, and
 * per-edge segment metadata (surface, grade, cycle lane) that the cycling
 * scorer reads. Both are optional; a plain response must not produce undefined
 * holes.
 */

import { describe, test, expect } from 'bun:test'
import { BarrelmanValhallaAdapter } from './barrelman-valhalla-adapter'

const adapter = new BarrelmanValhallaAdapter()

const request = {
  requestId: 'req-1',
  mode: 'driving',
  waypoints: [
    { id: 'w0', coordinate: { lat: 35.2, lng: -80.8 } },
    { id: 'w1', coordinate: { lat: 35.3, lng: -80.9 } },
  ],
} as any

function response(over: Partial<any> = {}): any {
  return {
    trip: {
      shape: '',
      summary: {
        length: 12.5,
        time: 900,
        min_lat: 35.2,
        min_lon: -80.9,
        max_lat: 35.3,
        max_lon: -80.8,
        has_toll: false,
        has_highway: true,
        has_ferry: false,
      },
      legs: [
        {
          shape: '',
          summary: {
            length: 12.5,
            time: 900,
            has_toll: false,
            has_highway: true,
            has_ferry: false,
          },
          maneuvers: [],
        },
      ],
      ...over,
    },
  }
}

const adapt = (r: any, req: any = request) => adapter.adaptRouteResponse(r, req)

describe('unit conversion', () => {
  test('converts the trip length from kilometres to metres', () => {
    expect(adapt(response()).routes[0].summary.totalDistance).toBe(12500)
  })

  test('converts leg length to metres', () => {
    expect(adapt(response()).routes[0].legs[0].distance).toBe(12500)
  })

  test('leaves durations in seconds', () => {
    const route = adapt(response()).routes[0]

    expect(route.summary.totalDuration).toBe(900)
    expect(route.legs[0].duration).toBe(900)
  })
})

describe('summary', () => {
  test('carries the route characteristic flags', () => {
    expect(adapt(response()).routes[0].summary).toMatchObject({
      hasTolls: false,
      hasHighways: true,
      hasFerries: false,
    })
  })

  test('computes the arrival time from the departure time', () => {
    const departureTime = new Date('2026-01-01T09:00:00Z')

    const summary = adapt(response(), { ...request, departureTime }).routes[0]
      .summary

    expect(summary.arrivalTime!.toISOString()).toBe('2026-01-01T09:15:00.000Z')
  })

  test('leaves the arrival time undefined without a departure time', () => {
    expect(adapt(response()).routes[0].summary.arrivalTime).toBeUndefined()
  })

  test('reports the bounding box in lng/lat order', () => {
    expect(adapt(response()).routes[0].boundingBox).toEqual([
      -80.9, 35.2, -80.8, 35.3,
    ])
  })
})

describe('geometry and elevation', () => {
  test('decodes the trip shape', () => {
    const route = adapt(response({ shape: '_p~iF~ps|U' })).routes[0]

    expect(route.geometry).toHaveLength(1)
  })

  test('zips per-vertex elevation onto the leg geometry', () => {
    const route = adapt(
      response({
        legs: [
          {
            shape: '_p~iF~ps|U_ulLnnqC',
            summary: { length: 1, time: 60 },
            maneuvers: [],
            elevation: [120, 135],
          },
        ],
      }),
    ).routes[0]

    expect(route.legs[0].geometry[0].elevation).toBe(120)
    expect(route.legs[0].geometry[1].elevation).toBe(135)
  })

  test('leaves elevation undefined when the proxy did not enrich it', () => {
    const route = adapt(
      response({
        legs: [
          {
            shape: '_p~iF~ps|U',
            summary: { length: 1, time: 60 },
            maneuvers: [],
          },
        ],
      }),
    ).routes[0]

    expect(route.legs[0].geometry[0].elevation).toBeUndefined()
  })

  test('carries elevation statistics when present', () => {
    const route = adapt(
      response({
        legs: [
          {
            shape: '',
            summary: { length: 1, time: 60 },
            maneuvers: [],
            elevation_stats: {
              totalGain: 120,
              totalLoss: 80,
              maxElevation: 300,
              minElevation: 180,
            },
          },
        ],
      }),
    ).routes[0]

    expect(route.legs[0]).toMatchObject({
      totalElevationGain: 120,
      totalElevationLoss: 80,
      maxElevation: 300,
      minElevation: 180,
    })
  })

  test('omits elevation statistics for a plain response', () => {
    const leg = adapt(response()).routes[0].legs[0]

    expect(leg.totalElevationGain).toBeUndefined()
    expect(leg.maxElevation).toBeUndefined()
  })
})

describe('edge segments', () => {
  test('maps enriched per-edge metadata', () => {
    const route = adapt(
      response({
        legs: [
          {
            shape: '',
            summary: { length: 1, time: 60 },
            maneuvers: [],
            edge_segments: [
              {
                startDistance: 0,
                endDistance: 250,
                surface: 'paved',
                roadClass: 'residential',
                use: 'road',
                cycleLane: 'lane',
                shoulder: true,
                speedLimit: 40,
                laneCount: 2,
                weightedGrade: 1.5,
                meanElevation: 210,
              },
            ],
          },
        ],
      }),
    ).routes[0]

    expect(route.legs[0].edgeSegments).toHaveLength(1)
    expect(route.legs[0].edgeSegments![0]).toMatchObject({
      surface: 'paved',
      roadClass: 'residential',
      cycleLane: 'lane',
      speedLimit: 40,
      weightedGrade: 1.5,
    })
  })

  test('leaves edge segments undefined on a plain response', () => {
    // The cycling scorer checks for presence; an empty array would read as
    // "enriched but featureless".
    expect(adapt(response()).routes[0].legs[0].edgeSegments).toBeUndefined()
  })
})

describe('legs and waypoints', () => {
  test('pairs each leg with its start and end waypoint', () => {
    const leg = adapt(response()).routes[0].legs[0]

    expect(leg.startWaypoint).toBe(request.waypoints[0])
    expect(leg.endWaypoint).toBe(request.waypoints[1])
  })

  test('carries the requested travel mode onto the leg', () => {
    const leg = adapt(response(), { ...request, mode: 'cycling' }).routes[0].legs[0]

    expect(leg.mode).toBe('cycling')
  })

  test('handles a multi-leg trip', () => {
    const route = adapt(
      response({
        legs: [
          { shape: '', summary: { length: 1, time: 60 }, maneuvers: [] },
          { shape: '', summary: { length: 2, time: 120 }, maneuvers: [] },
        ],
      }),
      {
        ...request,
        waypoints: [
          { id: 'w0' },
          { id: 'w1' },
          { id: 'w2' },
        ],
      },
    ).routes[0]

    expect(route.legs).toHaveLength(2)
    expect(route.legs[1].distance).toBe(2000)
  })
})

describe('instructions', () => {
  const withManeuvers = (...maneuvers: any[]) =>
    adapt(
      response({
        legs: [
          {
            shape: '_p~iF~ps|U_ulLnnqC',
            summary: { length: 1, time: 60 },
            maneuvers,
          },
        ],
      }),
    ).routes[0].legs[0].instructions

  test('converts maneuver length to metres', () => {
    const [instruction] = withManeuvers({
      type: 1,
      instruction: 'Head north',
      length: 0.25,
      time: 30,
      begin_shape_index: 0,
    })

    expect(instruction.distance).toBe(250)
    expect(instruction.duration).toBe(30)
  })

  test('resolves the coordinate from begin_shape_index', () => {
    const [instruction] = withManeuvers({
      type: 1,
      instruction: 'Head north',
      length: 1,
      time: 30,
      begin_shape_index: 1,
    })

    expect(instruction.coordinate).not.toEqual({ lat: 0, lng: 0 })
  })

  test('falls back to 0,0 for an out-of-range shape index', () => {
    const [instruction] = withManeuvers({
      type: 1,
      instruction: 'Head north',
      length: 1,
      time: 30,
      begin_shape_index: 99,
    })

    expect(instruction.coordinate).toEqual({ lat: 0, lng: 0 })
  })

  test('takes the first street name', () => {
    const [instruction] = withManeuvers({
      type: 1,
      instruction: 'Head north',
      length: 1,
      time: 30,
      begin_shape_index: 0,
      street_names: ['Main St', 'US-74'],
    })

    expect(instruction.streetName).toBe('Main St')
  })

  test('parses a motorway exit number', () => {
    const [instruction] = withManeuvers({
      type: 1,
      instruction: 'Take exit 12',
      length: 1,
      time: 30,
      begin_shape_index: 0,
      sign: { exit_number: '12' },
    })

    expect(instruction.exitNumber).toBe(12)
  })

  test('leaves the exit number undefined when absent', () => {
    const [instruction] = withManeuvers({
      type: 1,
      instruction: 'Head north',
      length: 1,
      time: 30,
      begin_shape_index: 0,
    })

    expect(instruction.exitNumber).toBeUndefined()
  })

  const types: Array<[number, string]> = [
    [0, 'none'],
    [1, 'start'],
    [2, 'start-right'],
    [3, 'start-left'],
  ]

  for (const [type, expected] of types) {
    test(`maps maneuver type ${type} to "${expected}"`, () => {
      const [instruction] = withManeuvers({
        type,
        instruction: 'x',
        length: 1,
        time: 1,
        begin_shape_index: 0,
      })

      expect(instruction.type).toBe(expected)
    })
  }
})

describe('metadata', () => {
  test('attributes the route to Barrelman’s Valhalla proxy', () => {
    const result = adapt(response())

    expect(result.metadata.provider).toBe('barrelman')
    expect(result.metadata.attribution[0]).toContain('Valhalla')
    expect(result.routes[0].provider).toBe('barrelman')
  })

  test('echoes the request id', () => {
    expect(adapt(response()).metadata.requestId).toBe('req-1')
  })
})
