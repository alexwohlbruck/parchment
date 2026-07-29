/**
 * Unit tests for the GraphHopper routing adapter.
 *
 * The unit trap is the mirror image of Valhalla's: GraphHopper reports
 * distances already in METRES but times in MILLISECONDS, so times are ÷1000
 * while distances pass through untouched. Applying the wrong conversion to
 * either shows a 15-minute drive as 15 000 minutes, or a 12km route as 12m.
 *
 * Its polyline is precision 5 (Google-standard), unlike Valhalla's 6 — the two
 * adapters sit side by side and are easy to cross-wire.
 *
 * The `sign` → maneuver mapping is a lookup table straight out of GraphHopper's
 * docs; every arm is pinned because an off-by-one there produces confidently
 * wrong turn-by-turn directions.
 */

import { describe, test, expect } from 'bun:test'
import { GraphHopperAdapter } from './graphhopper-adapter'
import { SOURCE } from '../../../lib/constants'

const adapter = new GraphHopperAdapter()

function response(over: Partial<any> = {}): any {
  return {
    paths: [
      {
        distance: 12500,
        time: 900_000,
        points: '',
        bbox: [-80.9, 35.2, -80.8, 35.3],
        instructions: [],
        ...over,
      },
    ],
  }
}

const adapt = (r: any, url?: string) => adapter.routing.adaptRouteResponse(r, url)

describe('unit conversion', () => {
  test('passes distances through — GraphHopper already reports metres', () => {
    const route = adapt(response())

    expect(route.summary.distance).toBe(12500)
    expect(route.legs[0].distance).toBe(12500)
  })

  test('converts times from milliseconds to seconds', () => {
    const route = adapt(response())

    expect(route.summary.time).toBe(900)
    expect(route.legs[0].time).toBe(900)
  })

  test('rounds a fractional second', () => {
    const route = adapt(response({ time: 900_499 }))

    expect(route.summary.time).toBe(900)
  })
})

describe('geometry', () => {
  test('decodes an encoded polyline at precision 5', () => {
    // The same string at precision 6 would be (3.85, -12.02); GraphHopper is 5.
    const route = adapt(response({ points: '_p~iF~ps|U' }))

    expect(route.legs[0].geometry[0].lat).toBeCloseTo(38.5, 4)
    expect(route.legs[0].geometry[0].lng).toBeCloseTo(-120.2, 4)
  })

  test('accepts GeoJSON points and flips lng/lat', () => {
    const route = adapt(
      response({
        points: {
          type: 'LineString',
          coordinates: [
            [-80.8, 35.2],
            [-80.9, 35.3],
          ],
        },
      }),
    )

    expect(route.legs[0].geometry).toEqual([
      { lat: 35.2, lng: -80.8 },
      { lat: 35.3, lng: -80.9 },
    ])
  })

  test('keeps the raw shape only for the encoded form', () => {
    expect(adapt(response({ points: '_p~iF~ps|U' })).legs[0].shape).toBe(
      '_p~iF~ps|U',
    )
    expect(
      adapt(response({ points: { type: 'LineString', coordinates: [] } }))
        .legs[0].shape,
    ).toBe('')
  })

  test('returns an empty geometry for an empty polyline', () => {
    expect(adapt(response()).legs[0].geometry).toEqual([])
  })
})

describe('locations', () => {
  test('prefers the snapped waypoints', () => {
    const route = adapt(
      response({
        snapped_waypoints: {
          type: 'LineString',
          coordinates: [
            [-80.8, 35.2],
            [-80.9, 35.3],
          ],
        },
      }),
    )

    expect(route.locations).toEqual([
      { lat: 35.2, lng: -80.8 },
      { lat: 35.3, lng: -80.9 },
    ])
  })

  test('falls back to the first and last geometry points', () => {
    const route = adapt(
      response({
        points: {
          type: 'LineString',
          coordinates: [
            [-80.8, 35.2],
            [-80.85, 35.25],
            [-80.9, 35.3],
          ],
        },
      }),
    )

    expect(route.locations).toEqual([
      { lat: 35.2, lng: -80.8 },
      { lat: 35.3, lng: -80.9 },
    ])
  })

  test('is empty when neither waypoints nor a usable geometry exist', () => {
    expect(adapt(response()).locations).toEqual([])
  })
})

describe('summary', () => {
  test('maps the bbox into bounds', () => {
    expect(adapt(response()).summary.bounds).toEqual({
      minLng: -80.9,
      minLat: 35.2,
      maxLng: -80.8,
      maxLat: 35.3,
    })
  })

  test('reports the route characteristic flags as false', () => {
    // The basic response carries no ferry/toll details.
    expect(adapt(response()).summary).toMatchObject({
      hasFerry: false,
      hasHighway: false,
      hasToll: false,
      hasTimeRestrictions: false,
    })
  })
})

describe('instructions', () => {
  const withInstructions = (...instructions: any[]) =>
    adapt(
      response({
        points: {
          type: 'LineString',
          coordinates: [
            [-80.8, 35.2],
            [-80.85, 35.25],
          ],
        },
        instructions,
      }),
    ).legs[0].maneuvers

  test('maps text, distance and time', () => {
    const [maneuver] = withInstructions({
      text: 'Turn right onto Main St',
      distance: 250,
      time: 30_000,
      sign: 2,
      interval: [0, 1],
      street_name: 'Main St',
    })

    expect(maneuver).toMatchObject({
      instruction: 'Turn right onto Main St',
      distance: 250,
      time: 30,
      streetName: 'Main St',
    })
  })

  test('resolves the maneuver coordinate from the interval index', () => {
    const [maneuver] = withInstructions({
      text: 'Turn',
      distance: 1,
      time: 1000,
      sign: 2,
      interval: [1, 1],
    })

    expect(maneuver.coordinate).toEqual({ lat: 35.25, lng: -80.85 })
  })

  test('falls back to 0,0 for an out-of-range interval', () => {
    const [maneuver] = withInstructions({
      text: 'Turn',
      distance: 1,
      time: 1000,
      sign: 2,
      interval: [99, 99],
    })

    expect(maneuver.coordinate).toEqual({ lat: 0, lng: 0 })
  })

  test('emits no maneuvers when instructions are absent', () => {
    expect(adapt(response({ instructions: undefined })).legs[0].maneuvers).toEqual(
      [],
    )
  })

  const signs: Array<[number, string]> = [
    [-98, 'u-turn'],
    [-8, 'u-turn'],
    [-7, 'keep-left'],
    [-6, 'roundabout-exit'],
    [-3, 'turn-sharp-left'],
    [-2, 'turn-left'],
    [-1, 'turn-slight-left'],
    [0, 'continue'],
    [1, 'turn-slight-right'],
    [2, 'turn-right'],
    [3, 'turn-sharp-right'],
    [4, 'arrive'],
    [5, 'waypoint'],
    [6, 'roundabout-enter'],
    [7, 'keep-right'],
    [8, 'u-turn'],
  ]

  for (const [sign, expected] of signs) {
    test(`maps sign ${sign} to "${expected}"`, () => {
      const [maneuver] = withInstructions({
        text: 'x',
        distance: 1,
        time: 1000,
        sign,
        interval: [0, 1],
      })

      expect(maneuver.type).toBe(expected)
    })
  }

  test('falls back to continue for an unknown sign', () => {
    const [maneuver] = withInstructions({
      text: 'x',
      distance: 1,
      time: 1000,
      sign: 42,
      interval: [0, 1],
    })

    expect(maneuver.type).toBe('continue')
  })
})

describe('envelope', () => {
  test('throws when the response carries no paths', () => {
    expect(() => adapt({ paths: [] })).toThrow('No paths found')
    expect(() => adapt({})).toThrow('No paths found')
  })

  test('uses the first path as the primary route', () => {
    const route = adapt({
      paths: [
        { distance: 100, time: 1000, points: '', bbox: [0, 0, 1, 1] },
        { distance: 999, time: 9000, points: '', bbox: [0, 0, 1, 1] },
      ],
    })

    expect(route.summary.distance).toBe(100)
  })

  test('attributes the route to GraphHopper', () => {
    const route = adapt(response(), 'https://gh.test/route')

    expect(route.source).toEqual({
      id: SOURCE.GRAPHHOPPER,
      name: 'GraphHopper',
      url: 'https://gh.test/route',
    })
  })

  test('reports an OK status', () => {
    expect(adapt(response()).status).toEqual({ code: 0, message: 'OK' })
  })

  test('keeps the raw response for debugging', () => {
    const payload = response()

    expect(adapt(payload).raw).toBe(payload)
  })

  test('produces exactly one leg — GraphHopper does not split routes', () => {
    expect(adapt(response()).legs).toHaveLength(1)
  })
})
