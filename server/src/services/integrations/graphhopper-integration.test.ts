/**
 * Unit tests for the GraphHopper integration.
 *
 * Two deployment shapes share one class: a self-hosted instance (config
 * `host`) and the hosted GraphHopper API (config `apiKey`, fixed base URL).
 * The distinction is not cosmetic — `custom_model` requires flexible mode,
 * which the free hosted tier rejects, so preferences are silently DROPPED for
 * non-self-hosted configs rather than producing a 400. That behaviour is
 * asserted in both directions.
 *
 * Unit conversions are the other recurring hazard. GraphHopper reports
 * durations in MILLISECONDS while the unified format uses seconds, and points
 * arrive as GeoJSON [lng, lat, elevation] triples — lng first. Both are
 * covered, including the elevation slot, which drives the elevation profile.
 *
 * `edgeSegments` is the most involved transform: GraphHopper details are
 * [startPointIndex, endPointIndex, value] over the point array, and they have
 * to be re-cut on the union of every detail's breakpoints and re-expressed as
 * cumulative Haversine DISTANCES. A missing `max_speed` must stay undefined
 * rather than becoming 0 — "unknown limit" and "limit is zero" are different
 * claims.
 */

import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test'

mock.module('../../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
  logError: () => {},
  logWarn: () => {},
}))

const { GraphHopperIntegration } = await import('./graphhopper-integration')
const { TravelMode } = await import('../../types/unified-routing.types')

const HOST = 'http://graphhopper.test'
const selfHosted = { host: HOST }
const hostedApi = { apiKey: 'gh-key' }

function configured(config: Record<string, unknown> = selfHosted) {
  const integration = new GraphHopperIntegration()
  integration.initialize(config)
  return integration
}

const getRoute = (integration: any) => integration.capabilities.routing.getRoute

/** Three points along N Davidson St, with elevations. */
const POINTS = {
  type: 'LineString',
  coordinates: [
    [-80.84, 35.22, 210],
    [-80.83, 35.23, 235],
    [-80.82, 35.24, 220],
  ],
}

const path = (over: Record<string, any> = {}) => ({
  distance: 1500,
  time: 420000,
  ascend: 25,
  descend: 15,
  bbox: [-80.84, 35.22, -80.82, 35.24],
  points: POINTS,
  instructions: [
    {
      sign: 0,
      text: 'Continue onto N Davidson St',
      distance: 1500,
      time: 420000,
      interval: [0, 2],
      street_name: 'N Davidson St',
      heading: 12,
    },
  ],
  ...over,
})

const routeResponse = (over: Record<string, any> = {}) => ({
  info: { took: 12, copyrights: ['GraphHopper', 'OpenStreetMap contributors'] },
  paths: over.paths ?? [path(over.path)],
})

const routeRequest = (over: Record<string, unknown> = {}) => ({
  waypoints: [
    { coordinate: { lat: 35.22, lng: -80.84 } },
    { coordinate: { lat: 35.24, lng: -80.82 } },
  ],
  mode: TravelMode.DRIVING,
  ...over,
})

const realFetch = globalThis.fetch
const realLog = console.log
let calls: [string, any][] = []
let fetchImpl: (url: string, init?: any) => Promise<any>

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })

const bodyOf = (index = 0) => JSON.parse(calls[index][1].body)

beforeEach(() => {
  calls = []
  fetchImpl = async () => ok(routeResponse())
  globalThis.fetch = ((url: string, init?: any) => {
    calls.push([url, init])
    return fetchImpl(url, init)
  }) as any
  console.log = () => {}
})

afterEach(() => {
  globalThis.fetch = realFetch
  console.log = realLog
})

describe('configuration', () => {
  test('accepts either a host or an API key', () => {
    const integration = new GraphHopperIntegration()

    expect(integration.validateConfig(selfHosted)).toBe(true)
    expect(integration.validateConfig(hostedApi)).toBe(true)
    expect(integration.validateConfig({})).toBe(false)
    expect(integration.validateConfig(undefined as any)).toBe(false)
  })

  test('initialize refuses a config with neither', () => {
    expect(() => new GraphHopperIntegration().initialize({})).toThrow(
      'Either host',
    )
  })

  test('declares only routing', () => {
    expect(new GraphHopperIntegration().capabilityIds).toEqual(['routing'])
  })

  test('refuses to route before initialization', async () => {
    await expect(
      getRoute(new GraphHopperIntegration())(routeRequest() as any),
    ).rejects.toThrow('has not been initialized')
    expect(calls).toHaveLength(0)
  })
})

describe('routing metadata', () => {
  const metadata = new GraphHopperIntegration().capabilities.routing.metadata

  test('advertises the six profiles it can map', () => {
    expect(metadata.supportedModes).toEqual([
      'driving',
      'walking',
      'cycling',
      'motorcycle',
      'truck',
    ])
  })

  test('claims alternatives and elevation but not traffic or transit', () => {
    expect(metadata.features.alternatives).toBe(true)
    expect(metadata.features.elevation).toBe(true)
    expect(metadata.features.traffic).toBe(false)
    expect(metadata.features.transit).toBe(false)
  })

  test('disclaims the preferences it cannot express', () => {
    const prefs = metadata.supportedPreferences

    expect(prefs.litPaths).toBe(false)
    expect(prefs.preferHOV).toBe(false)
    expect(prefs.maxWalkDistance).toBe(false)
    expect(prefs.highways).toBe('range')
  })
})

describe('base URL selection', () => {
  test('uses the configured host when self-hosted', async () => {
    fetchImpl = async () => ok({ version: '9.0', profiles: [] })

    await new GraphHopperIntegration().testConnection(selfHosted)

    expect(calls[0][0]).toBe(`${HOST}/info`)
  })

  test('strips a trailing slash from the host', async () => {
    fetchImpl = async () => ok({ version: '9.0', profiles: [] })

    await new GraphHopperIntegration().testConnection({ host: `${HOST}/` })

    expect(calls[0][0]).toBe(`${HOST}/info`)
  })

  test('falls back to the hosted API when only a key is given', async () => {
    fetchImpl = async () => ok({ version: '9.0', profiles: [] })

    await new GraphHopperIntegration().testConnection(hostedApi)

    expect(calls[0][0]).toBe('https://graphhopper.com/api/1/info?key=gh-key')
  })

  test('sends no key parameter for a self-hosted instance', async () => {
    fetchImpl = async () => ok({ version: '9.0', profiles: [] })

    await new GraphHopperIntegration().testConnection(selfHosted)

    expect(calls[0][0]).not.toContain('key=')
  })
})

describe('testConnection', () => {
  test('accepts a server that reports a version and profiles', async () => {
    fetchImpl = async () => ok({ version: '9.0', profiles: [{ name: 'car' }] })

    expect(
      await new GraphHopperIntegration().testConnection(selfHosted),
    ).toEqual({ success: true })
  })

  test('rejects a config with neither host nor key without a request', async () => {
    const result = await new GraphHopperIntegration().testConnection({})

    expect(result.success).toBe(false)
    expect(calls).toHaveLength(0)
  })

  test('rejects a server that answers but is not GraphHopper', async () => {
    fetchImpl = async () => ok({ hello: 'world' })

    expect(
      (await new GraphHopperIntegration().testConnection(selfHosted)).message,
    ).toBe('Server does not appear to be a GraphHopper instance')
  })

  test('surfaces the API error message from the body', async () => {
    fetchImpl = async () => ({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => JSON.stringify({ message: 'API key is invalid' }),
    })

    expect(
      (await new GraphHopperIntegration().testConnection(hostedApi)).message,
    ).toBe('API key is invalid')
  })

  test('falls back to the status line for a non-JSON error body', async () => {
    fetchImpl = async () => ({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      text: async () => '<html>nginx</html>',
    })

    expect(
      (await new GraphHopperIntegration().testConnection(selfHosted)).message,
    ).toContain('502')
  })

  test('surfaces a network failure message', async () => {
    fetchImpl = async () => {
      throw new Error('ECONNREFUSED')
    }

    expect(
      (await new GraphHopperIntegration().testConnection(selfHosted)).message,
    ).toBe('ECONNREFUSED')
  })
})

describe('request assembly', () => {
  test('posts points as [lng, lat] pairs', async () => {
    // GeoJSON order, the reverse of the coordinate objects it is built from.
    await getRoute(configured())(routeRequest() as any)

    expect(calls[0][0]).toBe(`${HOST}/route`)
    expect(bodyOf().points).toEqual([
      [-80.84, 35.22],
      [-80.82, 35.24],
    ])
  })

  test('rejects a request with fewer than two waypoints', async () => {
    await expect(
      getRoute(configured())(
        routeRequest({ waypoints: [{ coordinate: { lat: 1, lng: 2 } }] }) as any,
      ),
    ).rejects.toThrow('At least 2 waypoints')
    expect(calls).toHaveLength(0)
  })

  test('maps each travel mode to its profile', async () => {
    for (const [mode, profile] of [
      [TravelMode.DRIVING, 'car'],
      [TravelMode.CYCLING, 'bike'],
      [TravelMode.WALKING, 'foot'],
      [TravelMode.MOTORCYCLE, 'motorcycle'],
      [TravelMode.TRUCK, 'truck'],
    ] as const) {
      calls = []
      await getRoute(configured())(routeRequest({ mode }) as any)
      expect(bodyOf().profile).toBe(profile)
    }
  })

  test('rejects an unsupported travel mode', async () => {
    await expect(
      getRoute(configured())(routeRequest({ mode: 'teleport' }) as any),
    ).rejects.toThrow('Unsupported travel mode')
  })

  test('requests unencoded points with elevation', async () => {
    // points_encoded: false is what lets extractGeometry read GeoJSON.
    await getRoute(configured())(routeRequest() as any)

    expect(bodyOf()).toMatchObject({
      points_encoded: false,
      elevation: true,
      instructions: true,
      calc_points: true,
    })
  })

  test('requests the path details the segment view needs', async () => {
    await getRoute(configured())(routeRequest() as any)

    expect(bodyOf().details).toEqual([
      'road_class',
      'surface',
      'toll',
      'road_environment',
      'average_speed',
      'max_speed',
    ])
  })

  test('prevents snapping onto motorways and ferries', async () => {
    // Otherwise the origin can land mid-motorway with no legal way off.
    await getRoute(configured())(routeRequest() as any)

    expect(bodyOf().snap_preventions).toContain('motorway')
    expect(bodyOf().snap_preventions).toContain('ferry')
  })

  test('passes a normalized locale', async () => {
    await getRoute(configured())(routeRequest({ language: 'es' }) as any)

    expect(bodyOf().locale).toBe('es')
  })

  test('omits the locale when none is requested', async () => {
    await getRoute(configured())(routeRequest() as any)

    expect(bodyOf().locale).toBeUndefined()
  })

  test('suppresses instructions and geometry on request', async () => {
    await getRoute(configured())(
      routeRequest({ includeInstructions: false, includeGeometry: false }) as any,
    )

    expect(bodyOf().instructions).toBe(false)
    expect(bodyOf().calc_points).toBe(false)
  })

  test('appends the API key for the hosted service', async () => {
    await getRoute(configured(hostedApi))(routeRequest() as any)

    expect(calls[0][0]).toBe('https://graphhopper.com/api/1/route?key=gh-key')
  })

  test('surfaces the API error message from the body', async () => {
    fetchImpl = async () => ({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ message: 'Cannot find point 1' }),
    })

    await expect(getRoute(configured())(routeRequest() as any)).rejects.toThrow(
      'Cannot find point 1',
    )
  })

  test('falls back to the status and body for a non-JSON error', async () => {
    fetchImpl = async () => ({
      ok: false,
      status: 500,
      text: async () => 'internal error',
    })

    await expect(getRoute(configured())(routeRequest() as any)).rejects.toThrow(
      '500 - internal error',
    )
  })

  test('rethrows a transport failure', async () => {
    fetchImpl = async () => {
      throw new Error('ECONNREFUSED')
    }

    await expect(getRoute(configured())(routeRequest() as any)).rejects.toThrow(
      'GraphHopper routing error: ECONNREFUSED',
    )
  })

  test('throws when the response contains no paths', async () => {
    fetchImpl = async () => ok({ info: { took: 1 }, paths: [] })

    await expect(getRoute(configured())(routeRequest() as any)).rejects.toThrow(
      'No routes found',
    )
  })
})

describe('preferences', () => {
  const preferences = { highways: 0.1, ferries: 0 }

  test('sends a custom model for a self-hosted instance', async () => {
    await getRoute(configured())(routeRequest({ preferences }) as any)

    expect(bodyOf().custom_model).toBeDefined()
    // Custom models need flexible mode.
    expect(bodyOf()['ch.disable']).toBe(true)
  })

  test('drops the custom model for the hosted API', async () => {
    // The free tier rejects custom models outright.
    await getRoute(configured(hostedApi))(routeRequest({ preferences }) as any)

    expect(bodyOf().custom_model).toBeUndefined()
    expect(bodyOf()['ch.disable']).toBeUndefined()
  })

  test('treats a graphhopper.com host as hosted, not self-hosted', async () => {
    await getRoute(configured({ host: 'https://graphhopper.com/api/1' }))(
      routeRequest({ preferences }) as any,
    )

    expect(bodyOf().custom_model).toBeUndefined()
  })

  test('requests alternatives in every tier', async () => {
    // Unlike custom models, alternative_route works on the free plan.
    await getRoute(configured(hostedApi))(
      routeRequest({ preferences: { alternatives: true } }) as any,
    )

    expect(bodyOf().algorithm).toBe('alternative_route')
    expect(bodyOf()['alternative_route.max_paths']).toBe(2)
  })

  test('honours an explicit alternative count', async () => {
    await getRoute(configured())(
      routeRequest({
        preferences: { alternatives: true, maxAlternatives: 3 },
      }) as any,
    )

    expect(bodyOf()['alternative_route.max_paths']).toBe(3)
  })

  test('sends no algorithm when alternatives are not requested', async () => {
    await getRoute(configured())(routeRequest({ preferences }) as any)

    expect(bodyOf().algorithm).toBeUndefined()
  })
})

describe('response mapping', () => {
  test('reports the provider, attribution and processing time', async () => {
    const route = await getRoute(configured())(
      routeRequest({ requestId: 'req-1' }) as any,
    )

    expect(route.metadata).toMatchObject({
      provider: 'graphhopper',
      requestId: 'req-1',
      processingTime: 12,
    })
    expect(route.metadata.attribution).toContain('OpenStreetMap contributors')
  })

  test('converts durations from milliseconds to seconds', async () => {
    const route = await getRoute(configured())(routeRequest() as any)

    expect(route.routes[0].summary.totalDuration).toBe(420)
    expect(route.routes[0].summary.totalDistance).toBe(1500)
  })

  test('carries the ascend and descend GraphHopper reports', async () => {
    const route = await getRoute(configured())(routeRequest() as any)

    expect(route.routes[0].summary.totalElevationGain).toBe(25)
    expect(route.routes[0].summary.totalElevationLoss).toBe(15)
  })

  test('derives the arrival time from the departure time', async () => {
    const departureTime = new Date('2026-01-01T12:00:00Z')

    const route = await getRoute(configured())(
      routeRequest({ departureTime }) as any,
    )

    expect(route.routes[0].summary.arrivalTime).toEqual(
      new Date('2026-01-01T12:07:00Z'),
    )
  })

  test('ranks alternatives after the primary route', async () => {
    fetchImpl = async () =>
      ok(routeResponse({ paths: [path(), path({ distance: 1800 })] }))

    const route = await getRoute(configured())(routeRequest() as any)

    expect(route.routes.map((r: any) => r.rank)).toEqual([1, 2])
  })

  test('builds one leg spanning the first and last waypoints', async () => {
    // GraphHopper does not split legs; via points stay inside the single leg.
    const route = await getRoute(configured())(
      routeRequest({
        waypoints: [
          { coordinate: { lat: 1, lng: 2 } },
          { coordinate: { lat: 3, lng: 4 } },
          { coordinate: { lat: 5, lng: 6 } },
        ],
      }) as any,
    )

    expect(route.routes[0].legs).toHaveLength(1)
    expect(route.routes[0].legs[0].startWaypoint.coordinate).toEqual({
      lat: 1,
      lng: 2,
    })
    expect(route.routes[0].legs[0].endWaypoint.coordinate).toEqual({
      lat: 5,
      lng: 6,
    })
  })
})

describe('geometry extraction', () => {
  test('reads GeoJSON coordinates as lng, lat, elevation', async () => {
    const route = await getRoute(configured())(routeRequest() as any)

    expect(route.routes[0].geometry[0]).toEqual({
      lat: 35.22,
      lng: -80.84,
      elevation: 210,
    })
  })

  test('omits elevation for 2D coordinates', async () => {
    fetchImpl = async () =>
      ok(
        routeResponse({
          path: {
            points: {
              type: 'LineString',
              coordinates: [
                [-80.84, 35.22],
                [-80.82, 35.24],
              ],
            },
          },
        }),
      )

    const route = await getRoute(configured())(routeRequest() as any)

    expect(route.routes[0].geometry[0]).toEqual({ lat: 35.22, lng: -80.84 })
  })

  test('returns no geometry for an encoded polyline', async () => {
    // The integration always asks for unencoded points; a string means the
    // server ignored that, and decoding is not implemented.
    fetchImpl = async () => ok(routeResponse({ path: { points: 'abcdef' } }))

    const route = await getRoute(configured())(routeRequest() as any)

    expect(route.routes[0].geometry).toEqual([])
  })
})

describe('elevation statistics', () => {
  test('accumulates gain and loss along the profile', async () => {
    // 210 → 235 → 220: 25 up, then 15 down.
    const route = await getRoute(configured())(routeRequest() as any)
    const leg = route.routes[0].legs[0]

    expect(leg.totalElevationGain).toBe(25)
    expect(leg.totalElevationLoss).toBe(15)
    expect(leg.maxElevation).toBe(235)
    expect(leg.minElevation).toBe(210)
  })

  test('reports zero gain with no elevation data', async () => {
    fetchImpl = async () =>
      ok(
        routeResponse({
          path: {
            points: {
              type: 'LineString',
              coordinates: [
                [-80.84, 35.22],
                [-80.82, 35.24],
              ],
            },
          },
        }),
      )

    const route = await getRoute(configured())(routeRequest() as any)
    const leg = route.routes[0].legs[0]

    expect(leg.totalElevationGain).toBe(0)
    expect(leg.maxElevation).toBeUndefined()
  })
})

describe('route characteristics', () => {
  const characteristicsFor = async (details: Record<string, unknown>) => {
    calls = []
    fetchImpl = async () => ok(routeResponse({ path: { details } }))
    const route = await getRoute(configured())(routeRequest() as any)
    return route.routes[0].summary
  }

  test('detects tolls from either boolean or "yes"', async () => {
    expect((await characteristicsFor({ toll: [[0, 2, true]] })).hasTolls).toBe(true)
    expect((await characteristicsFor({ toll: [[0, 2, 'yes']] })).hasTolls).toBe(
      true,
    )
    expect((await characteristicsFor({ toll: [[0, 2, 'no']] })).hasTolls).toBe(
      false,
    )
  })

  test('counts motorway and trunk as highway', async () => {
    expect(
      (await characteristicsFor({ road_class: [[0, 2, 'motorway']] })).hasHighways,
    ).toBe(true)
    expect(
      (await characteristicsFor({ road_class: [[0, 2, 'trunk']] })).hasHighways,
    ).toBe(true)
    expect(
      (await characteristicsFor({ road_class: [[0, 2, 'residential']] }))
        .hasHighways,
    ).toBe(false)
  })

  test('detects a ferry from the road environment', async () => {
    expect(
      (await characteristicsFor({ road_environment: [[0, 2, 'ferry']] }))
        .hasFerries,
    ).toBe(true)
  })

  test('claims nothing when the response has no details', async () => {
    const summary = await characteristicsFor(undefined as any)

    expect(summary).toMatchObject({
      hasTolls: false,
      hasHighways: false,
      hasFerries: false,
    })
  })
})

describe('instructions', () => {
  const instructionFor = async (instruction: Record<string, unknown>) => {
    calls = []
    fetchImpl = async () =>
      ok(
        routeResponse({
          path: {
            instructions: [
              {
                sign: 0,
                text: 'Continue',
                distance: 100,
                time: 30000,
                interval: [0, 1],
                ...instruction,
              },
            ],
          },
        }),
      )
    const route = await getRoute(configured())(routeRequest() as any)
    return route.routes[0].legs[0].instructions[0]
  }

  test('carries the text, street name and heading', async () => {
    const instruction = await instructionFor({
      text: 'Turn right onto Central Ave',
      street_name: 'Central Ave',
      heading: 90,
    })

    expect(instruction.text).toBe('Turn right onto Central Ave')
    expect(instruction.streetName).toBe('Central Ave')
    expect(instruction.heading).toBe(90)
  })

  test('converts instruction duration to seconds', async () => {
    expect((await instructionFor({ time: 45000 })).duration).toBe(45)
  })

  test('anchors the instruction at the start of its interval', async () => {
    expect((await instructionFor({ interval: [1, 2] })).coordinate).toMatchObject(
      { lat: 35.23, lng: -80.83 },
    )
  })

  test('falls back to null island for an out-of-range interval', async () => {
    expect((await instructionFor({ interval: [99, 100] })).coordinate).toEqual({
      lat: 0,
      lng: 0,
    })
  })

  test('maps the GraphHopper sign values to instruction types', async () => {
    for (const [sign, expected] of [
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
    ] as const) {
      expect((await instructionFor({ sign })).type).toBe(expected)
    }
  })

  test('treats an unknown sign as continue', async () => {
    expect((await instructionFor({ sign: 42 })).type).toBe('continue')
  })

  test('maps signs to turn modifiers, flattening sharp turns', async () => {
    for (const [sign, expected] of [
      [-8, 'u-turn'],
      [-3, 'left'],
      [-2, 'left'],
      [-1, 'slight-left'],
      [0, 'straight'],
      [1, 'slight-right'],
      [2, 'right'],
      [3, 'right'],
    ] as const) {
      expect((await instructionFor({ sign })).modifier).toBe(expected)
    }
  })

  test('leaves the modifier unset for arrival and waypoints', async () => {
    expect((await instructionFor({ sign: 4 })).modifier).toBeUndefined()
    expect((await instructionFor({ sign: 5 })).modifier).toBeUndefined()
  })

  test('produces no instructions when the path carries none', async () => {
    fetchImpl = async () => ok(routeResponse({ path: { instructions: undefined } }))

    const route = await getRoute(configured())(routeRequest() as any)

    expect(route.routes[0].legs[0].instructions).toEqual([])
  })
})

describe('edge segments', () => {
  const segmentsFor = async (details: Record<string, unknown>) => {
    calls = []
    fetchImpl = async () => ok(routeResponse({ path: { details } }))
    const route = await getRoute(configured())(routeRequest() as any)
    return route.routes[0].legs[0].edgeSegments
  }

  test('expresses each segment as a cumulative distance range', async () => {
    const segments = await segmentsFor({
      road_class: [
        [0, 1, 'residential'],
        [1, 2, 'primary'],
      ],
      surface: [[0, 2, 'asphalt']],
    })

    expect(segments).toHaveLength(2)
    expect(segments[0].startDistance).toBe(0)
    // Distances are measured with Haversine, so they follow the geometry.
    expect(segments[0].endDistance).toBeGreaterThan(0)
    expect(segments[1].startDistance).toBe(segments[0].endDistance)
  })

  test('re-cuts on the union of every detail’s breakpoints', async () => {
    // road_class changes at 1 and surface at 2 → three segments.
    const segments = await segmentsFor({
      road_class: [
        [0, 1, 'residential'],
        [1, 3, 'primary'],
      ],
      surface: [
        [0, 2, 'asphalt'],
        [2, 3, 'gravel'],
      ],
    })

    expect(segments).toHaveLength(2)
    expect(segments.map((s: any) => s.roadClass)).toEqual([
      'residential',
      'primary',
    ])
  })

  test('normalizes surfaces onto the shared vocabulary', async () => {
    const surfaceOf = async (surface: string) =>
      (
        await segmentsFor({
          road_class: [[0, 2, 'residential']],
          surface: [[0, 2, surface]],
        })
      )[0].surface

    expect(await surfaceOf('asphalt')).toBe('paved_smooth')
    expect(await surfaceOf('cobblestone')).toBe('paved_rough')
    expect(await surfaceOf('compacted')).toBe('compacted')
    expect(await surfaceOf('ground')).toBe('dirt')
    expect(await surfaceOf('something_new')).toBe('unknown')
  })

  test('normalizes road classes, collapsing paths onto broader classes', async () => {
    const classOf = async (roadClass: string) =>
      (await segmentsFor({ road_class: [[0, 2, roadClass]] }))[0].roadClass

    expect(await classOf('motorway')).toBe('motorway')
    expect(await classOf('living_street')).toBe('residential')
    expect(await classOf('cycleway')).toBe('residential')
    expect(await classOf('track')).toBe('unclassified')
    expect(await classOf('something_new')).toBe('unknown')
  })

  test('lets the road environment override the use for ferries', async () => {
    const segments = await segmentsFor({
      road_class: [[0, 2, 'primary']],
      road_environment: [[0, 2, 'ferry']],
    })

    expect(segments[0].use).toBe('ferry')
  })

  test('keeps the road-class use for bridges and tunnels', async () => {
    // A bridge is still the road it carries.
    const segments = await segmentsFor({
      road_class: [[0, 2, 'cycleway']],
      road_environment: [[0, 2, 'bridge']],
    })

    expect(segments[0].use).toBe('cycleway')
  })

  test('carries the average speed the router used', async () => {
    const segments = await segmentsFor({
      road_class: [[0, 2, 'primary']],
      average_speed: [[0, 2, 48]],
    })

    expect(segments[0].averageSpeed).toBe(48)
  })

  test('leaves the speed limit undefined when OSM has no maxspeed', async () => {
    // Undefined means "unknown", which is not the same as a limit of zero.
    const segments = await segmentsFor({
      road_class: [[0, 2, 'primary']],
      max_speed: [[0, 2, null]],
    })

    expect(segments[0].speedLimit).toBeUndefined()
    expect('speedLimit' in segments[0]).toBe(false)
  })

  test('carries a tagged speed limit', async () => {
    const segments = await segmentsFor({
      road_class: [[0, 2, 'primary']],
      max_speed: [[0, 2, 56]],
    })

    expect(segments[0].speedLimit).toBe(56)
  })

  test('falls back to unknown for a gap in the detail coverage', async () => {
    const segments = await segmentsFor({
      road_class: [[0, 2, 'primary']],
      surface: [[1, 2, 'asphalt']],
    })

    expect(segments[0].surface).toBe('unknown')
  })

  test('produces no segments without road class or surface', async () => {
    expect(await segmentsFor({ toll: [[0, 2, true]] })).toEqual([])
  })

  test('produces no segments when the path has no details', async () => {
    fetchImpl = async () => ok(routeResponse({ path: { details: undefined } }))

    const route = await getRoute(configured())(routeRequest() as any)

    expect(route.routes[0].legs[0].edgeSegments).toEqual([])
  })
})
