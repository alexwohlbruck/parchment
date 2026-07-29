/**
 * Unit tests for the Barrelman→GraphHopper routing adapter.
 *
 * The bulk of this adapter is value normalization: GraphHopper emits raw OSM
 * surface strings and uppercase road classes, while the frontend charts expect
 * grouped categories (`paved_smooth`, `compacted`, `gravel`, …) and a `use`
 * field that Valhalla splits differently. Those tables are what the surface and
 * road-type charts on the trip detail render from, so a missing arm shows a
 * paved cycleway as "unknown".
 *
 * Elevation totals fall back from Barrelman's enriched `elevation_stats` to
 * GraphHopper's own `ascend`/`descend`, so a non-enriched response still
 * reports climb.
 */

import { describe, test, expect } from 'bun:test'
import { BarrelmanGraphHopperAdapter } from './barrelman-graphhopper-adapter'

const adapter = new BarrelmanGraphHopperAdapter()

const request = {
  requestId: 'req-1',
  mode: 'cycling',
  waypoints: [
    { id: 'w0', coordinate: { lat: 35.2, lng: -80.8 } },
    { id: 'w1', coordinate: { lat: 35.3, lng: -80.9 } },
  ],
} as any

function path(over: Partial<any> = {}): any {
  return {
    distance: 12500,
    time: 900_000,
    bbox: [-80.9, 35.2, -80.8, 35.3],
    points: {
      type: 'LineString',
      coordinates: [
        [-80.8, 35.2, 210],
        [-80.9, 35.3, 240],
      ],
    },
    instructions: [],
    ...over,
  }
}

const adapt = (paths: any[], req: any = request) =>
  adapter.adaptRouteResponse({ paths }, req)

/** Build a single-segment path and read back the mapped segment. */
function segment(seg: Record<string, unknown>) {
  return adapt([path({ edge_segments: [seg] })]).routes[0].legs[0]
    .edgeSegments![0]
}

describe('envelope', () => {
  test('returns no routes for an empty path list', () => {
    const result = adapt([])

    expect(result.routes).toEqual([])
    expect(result.metadata.provider).toBe('barrelman')
  })

  test('handles a response with no paths field at all', () => {
    const result = adapter.adaptRouteResponse({}, request)

    expect(result.routes).toEqual([])
  })

  test('attributes to GraphHopper via Barrelman', () => {
    expect(adapt([path()]).metadata.attribution[0]).toContain('GraphHopper')
  })

  test('echoes the request id', () => {
    expect(adapt([path()]).metadata.requestId).toBe('req-1')
  })

  test('maps every alternative path to its own route', () => {
    const result = adapt([path(), path({ distance: 9999 })])

    expect(result.routes).toHaveLength(2)
    expect(result.routes[1].summary.totalDistance).toBe(9999)
  })
})

describe('distance, duration and geometry', () => {
  test('passes distance through — GraphHopper reports metres', () => {
    expect(adapt([path()]).routes[0].summary.totalDistance).toBe(12500)
  })

  test('converts time from milliseconds to seconds', () => {
    const route = adapt([path()]).routes[0]

    expect(route.summary.totalDuration).toBe(900)
    expect(route.legs[0].duration).toBe(900)
  })

  test('flips GeoJSON lng/lat and lifts the third ordinate as elevation', () => {
    const route = adapt([path()]).routes[0]

    expect(route.geometry[0]).toEqual({ lat: 35.2, lng: -80.8, elevation: 210 })
  })

  test('leaves elevation undefined for 2D coordinates', () => {
    const route = adapt([
      path({
        points: { type: 'LineString', coordinates: [[-80.8, 35.2]] },
      }),
    ]).routes[0]

    expect(route.geometry[0].elevation).toBeUndefined()
  })

  test('handles a path with no points', () => {
    const route = adapt([path({ points: undefined })]).routes[0]

    expect(route.geometry).toEqual([])
  })

  test('defaults a missing bbox to zeroes', () => {
    expect(adapt([path({ bbox: undefined })]).routes[0].boundingBox).toEqual([
      0, 0, 0, 0,
    ])
  })

  test('computes the arrival time from the departure time', () => {
    const departureTime = new Date('2026-01-01T09:00:00Z')

    const summary = adapt([path()], { ...request, departureTime }).routes[0]
      .summary

    expect(summary.arrivalTime!.toISOString()).toBe('2026-01-01T09:15:00.000Z')
  })
})

describe('elevation fallbacks', () => {
  test('prefers Barrelman’s enriched elevation stats', () => {
    const leg = adapt([
      path({
        ascend: 10,
        descend: 20,
        elevation_stats: {
          totalGain: 120,
          totalLoss: 80,
          maxElevation: 300,
          minElevation: 180,
        },
      }),
    ]).routes[0].legs[0]

    expect(leg.totalElevationGain).toBe(120)
    expect(leg.totalElevationLoss).toBe(80)
    expect(leg.maxElevation).toBe(300)
  })

  test('falls back to GraphHopper ascend/descend when not enriched', () => {
    const leg = adapt([path({ ascend: 95, descend: 60 })]).routes[0].legs[0]

    expect(leg.totalElevationGain).toBe(95)
    expect(leg.totalElevationLoss).toBe(60)
  })

  test('leaves min/max undefined without enrichment', () => {
    const leg = adapt([path({ ascend: 95 })]).routes[0].legs[0]

    expect(leg.maxElevation).toBeUndefined()
    expect(leg.minElevation).toBeUndefined()
  })
})

describe('surface normalization', () => {
  const cases: Array<[string, string]> = [
    ['asphalt', 'paved_smooth'],
    ['concrete', 'paved_smooth'],
    ['paving_stones', 'paved'],
    ['paved', 'paved'],
    ['sett', 'paved_rough'],
    ['cobblestone', 'paved_rough'],
    ['wood', 'paved_rough'],
    ['compacted', 'compacted'],
    ['fine_gravel', 'compacted'],
    ['gravel', 'gravel'],
    ['pebblestone', 'gravel'],
    ['dirt', 'dirt'],
    ['mud', 'dirt'],
    ['sand', 'path'],
    ['grass', 'path'],
    ['ground', 'path'],
  ]

  for (const [raw, expected] of cases) {
    test(`maps "${raw}" to "${expected}"`, () => {
      expect(segment({ surface: raw }).surface).toBe(expected)
    })
  }

  test('is case-insensitive', () => {
    expect(segment({ surface: 'ASPHALT' }).surface).toBe('paved_smooth')
  })

  test('maps GraphHopper’s "missing" sentinel to unknown', () => {
    expect(segment({ surface: 'missing' }).surface).toBe('unknown')
  })

  test('maps an absent surface to unknown', () => {
    expect(segment({}).surface).toBe('unknown')
  })

  test('maps an unrecognized surface to unknown', () => {
    expect(segment({ surface: 'moon_dust' }).surface).toBe('unknown')
  })
})

describe('road class and use mapping', () => {
  test('lowercases the road class', () => {
    expect(segment({ roadClass: 'RESIDENTIAL' }).roadClass).toBe('residential')
  })

  test('maps the "missing" sentinel to unknown', () => {
    expect(segment({ roadClass: 'missing' }).roadClass).toBe('unknown')
  })

  const useCases: Array<[string, string]> = [
    ['cycleway', 'cycleway'],
    ['footway', 'footway'],
    ['path', 'footway'],
    ['steps', 'steps'],
    ['track', 'track'],
    ['living_street', 'living_street'],
    ['residential', 'residential'],
    ['service', 'service_other'],
    ['unclassified', 'unclassified'],
    ['tertiary', 'tertiary'],
    ['tertiary_link', 'tertiary'],
    ['secondary_link', 'secondary'],
    ['primary_link', 'primary'],
    ['trunk_link', 'trunk'],
    ['motorway_link', 'motorway'],
  ]

  for (const [roadClass, expectedUse] of useCases) {
    test(`derives use "${expectedUse}" from road class "${roadClass}"`, () => {
      expect(segment({ roadClass }).use).toBe(expectedUse)
    })
  }

  test('defaults use to "road" for an unknown class', () => {
    expect(segment({ roadClass: 'skyway' }).use).toBe('road')
  })

  test('defaults use to "road" when the class is missing', () => {
    expect(segment({}).use).toBe('road')
  })
})

describe('bike network normalization', () => {
  test('lowercases the network name', () => {
    expect(segment({ bikeNetwork: 'LOCAL' }).bikeNetwork).toBe('local')
  })

  test('maps the "missing" sentinel to unknown', () => {
    expect(segment({ bikeNetwork: 'missing' }).bikeNetwork).toBe('unknown')
  })

  test('maps an absent network to unknown', () => {
    expect(segment({}).bikeNetwork).toBe('unknown')
  })
})

describe('edge segment passthrough', () => {
  test('carries the cycling-relevant fields through untouched', () => {
    const seg = segment({
      startDistance: 0,
      endDistance: 250,
      getOffBike: true,
      smoothness: 'good',
      averageSlope: 1.2,
      maxSlope: 4.5,
      speedLimit: 40,
      bikePriority: 0.8,
      crossing: 'traffic_signals',
    })

    expect(seg).toMatchObject({
      startDistance: 0,
      endDistance: 250,
      getOffBike: true,
      smoothness: 'good',
      averageSlope: 1.2,
      maxSlope: 4.5,
      speedLimit: 40,
      bikePriority: 0.8,
      crossing: 'traffic_signals',
    })
  })

  test('leaves edgeSegments undefined on a non-enriched path', () => {
    expect(adapt([path()]).routes[0].legs[0].edgeSegments).toBeUndefined()
  })
})

describe('instructions', () => {
  const withInstructions = (...instructions: any[]) =>
    adapt([path({ instructions })]).routes[0].legs[0].instructions

  test('converts instruction time to seconds', () => {
    const [instruction] = withInstructions({
      sign: 2,
      text: 'Turn right',
      distance: 250,
      time: 30_000,
      interval: [0, 1],
    })

    expect(instruction.duration).toBe(30)
    expect(instruction.distance).toBe(250)
    expect(instruction.text).toBe('Turn right')
  })

  test('resolves the coordinate from the interval start', () => {
    const [instruction] = withInstructions({
      sign: 2,
      text: 'x',
      interval: [1, 1],
    })

    expect(instruction.coordinate).toMatchObject({ lat: 35.3, lng: -80.9 })
  })

  test('falls back to 0,0 for an out-of-range interval', () => {
    const [instruction] = withInstructions({ sign: 2, text: 'x', interval: [9, 9] })

    expect(instruction.coordinate).toEqual({ lat: 0, lng: 0 })
  })

  const signTypes: Array<[number, string]> = [
    [0, 'continue'],
    [1, 'turn'],
    [-1, 'turn'],
    [2, 'turn'],
    [-3, 'turn'],
    [7, 'continue'],
    [-7, 'continue'],
    [8, 'turn'],
    [-98, 'turn'],
    [4, 'destination'],
    [5, 'destination'],
    [6, 'roundabout'],
    [-6, 'roundabout'],
  ]

  for (const [sign, expected] of signTypes) {
    test(`maps sign ${sign} to type "${expected}"`, () => {
      const [instruction] = withInstructions({ sign, text: 'x', interval: [0] })

      expect(instruction.type).toBe(expected)
    })
  }

  const signModifiers: Array<[number, string | undefined]> = [
    [0, 'straight'],
    [-1, 'slight-left'],
    [1, 'slight-right'],
    [-2, 'left'],
    [2, 'right'],
    [-3, 'left'],
    [3, 'right'],
    [-7, 'slight-left'],
    [7, 'slight-right'],
    [-8, 'u-turn'],
    [8, 'u-turn'],
    [-98, 'u-turn'],
    [4, undefined],
  ]

  for (const [sign, expected] of signModifiers) {
    test(`maps sign ${sign} to modifier ${expected ?? 'undefined'}`, () => {
      const [instruction] = withInstructions({ sign, text: 'x', interval: [0] })

      expect(instruction.modifier).toBe(expected as any)
    })
  }

  test('defaults missing text and distance', () => {
    const [instruction] = withInstructions({ sign: 0, interval: [0] })

    expect(instruction.text).toBe('')
    expect(instruction.distance).toBe(0)
  })
})
