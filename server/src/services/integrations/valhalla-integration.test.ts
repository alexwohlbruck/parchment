/**
 * Unit tests for the Valhalla integration.
 *
 * Valhalla is the routing engine with the richest preference surface, and the
 * translation from Parchment's unified preferences into per-costing options is
 * where most of the logic lives. Three things make it error-prone:
 *
 * - Every preference has a modern 0–1 range form AND a legacy boolean form.
 *   The range wins when present; the boolean maps to 0 (avoid) or 0.5
 *   (neutral) — NOT to 1, which would mean "actively prefer".
 * - Options are namespaced by costing model (`auto`, `bicycle`, `pedestrian`,
 *   …), so a preference set on the wrong branch is silently ignored.
 * - Valhalla speaks KILOMETERS; the unified format is METERS. Every distance
 *   crossing the boundary is scaled, and one missed conversion is a 1000x
 *   error that still renders as a plausible route.
 *
 * Polyline decoding uses precision 6 (Valhalla's default), not the precision 5
 * that Google-style polylines use — decoding at the wrong precision puts the
 * route in the Gulf of Guinea rather than failing.
 */

import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test'

mock.module('../../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
  logError: () => {},
  logWarn: () => {},
}))

const { ValhallaIntegration } = await import('./valhalla-integration')
const { TravelMode, WaypointType } = await import(
  '../../types/unified-routing.types'
)

const HOST = 'http://valhalla.test'
const validConfig = { host: HOST }

function configured() {
  const integration = new ValhallaIntegration()
  integration.initialize(validConfig)
  return integration
}

const getRoute = (integration: any) => integration.capabilities.routing.getRoute

/**
 * A polyline (precision 6) for
 * [35.22,-80.84] → [35.23,-80.83] → [35.24,-80.82].
 */
const SHAPE = '_atdbA~raeyC_pR_pR_pR_pR'

const valhallaResponse = (over: Record<string, any> = {}) => ({
  trip: {
    shape: SHAPE,
    summary: {
      length: 1.5,
      time: 420,
      has_toll: false,
      has_highway: true,
      has_ferry: false,
      min_lat: 35.22,
      min_lon: -80.84,
      max_lat: 35.24,
      max_lon: -80.82,
      ...over.summary,
    },
    legs: over.legs ?? [
      {
        shape: SHAPE,
        summary: {
          length: 1.5,
          time: 420,
          has_toll: false,
          has_highway: true,
          has_ferry: false,
        },
        maneuvers: [
          {
            type: 1,
            instruction: 'Drive north on N Davidson St.',
            length: 1.5,
            time: 420,
            begin_shape_index: 0,
            street_names: ['N Davidson St'],
          },
        ],
      },
    ],
  },
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

/** The parsed request body of the call at `index`. */
const bodyOf = (index = 0) => JSON.parse(calls[index][1].body)

/** The costing options block for the given costing model. */
const costingOf = (model: string, index = 0) => bodyOf(index).costing_options?.[model]

beforeEach(() => {
  calls = []
  fetchImpl = async () => ok(valhallaResponse())
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
  test('requires a host', () => {
    const integration = new ValhallaIntegration()

    expect(integration.validateConfig(validConfig)).toBe(true)
    expect(integration.validateConfig({ host: '' })).toBe(false)
    expect(integration.validateConfig({ host: 123 } as any)).toBe(false)
  })

  test('initialize refuses a missing host', () => {
    expect(() => new ValhallaIntegration().initialize({ host: '' })).toThrow(
      'Host is required',
    )
  })

  test('declares only routing', () => {
    expect(new ValhallaIntegration().capabilityIds).toEqual(['routing'])
  })

  test('refuses to route before initialization', async () => {
    await expect(
      getRoute(new ValhallaIntegration())(routeRequest() as any),
    ).rejects.toThrow('has not been initialized')
    expect(calls).toHaveLength(0)
  })
})

describe('routing metadata', () => {
  const metadata = new ValhallaIntegration().capabilities.routing.metadata

  test('advertises the six costing models it can reach', () => {
    expect(metadata.supportedModes).toEqual([
      'driving',
      'walking',
      'cycling',
      'motorcycle',
      'truck',
      'wheelchair',
    ])
  })

  test('advertises alternatives and elevation but not transit', () => {
    expect(metadata.features.alternatives).toBe(true)
    expect(metadata.features.elevation).toBe(true)
    expect(metadata.features.transit).toBe(false)
  })

  test('marks the natively-numeric preferences as ranges', () => {
    // Valhalla takes 0–1 floats directly, unlike the boolean-only providers.
    const prefs = metadata.supportedPreferences

    expect(prefs.highways).toBe('range')
    expect(prefs.tolls).toBe('range')
    expect(prefs.hills).toBe('range')
    expect(prefs.shortest).toBe('boolean')
    expect(prefs.maxTransfers).toBe(false)
  })
})

describe('testConnection', () => {
  test('probes the status endpoint', async () => {
    fetchImpl = async () => ok({ version: '3.4.0' })

    const result = await new ValhallaIntegration().testConnection(validConfig)

    expect(result).toEqual({ success: true })
    expect(calls[0][0]).toBe(`${HOST}/status`)
  })

  test('accepts a status body identified only by its tileset', async () => {
    fetchImpl = async () => ok({ tileset_last_modified: 1700000000 })

    expect(
      (await new ValhallaIntegration().testConnection(validConfig)).success,
    ).toBe(true)
  })

  test('rejects a config with no host without a request', async () => {
    const result = await new ValhallaIntegration().testConnection({ host: '' })

    expect(result.success).toBe(false)
    expect(calls).toHaveLength(0)
  })

  test('strips a trailing slash from the host', async () => {
    fetchImpl = async () => ok({ version: '3.4.0' })

    await new ValhallaIntegration().testConnection({ host: `${HOST}/` })

    expect(calls[0][0]).toBe(`${HOST}/status`)
  })

  test('rejects a server that answers but is not Valhalla', async () => {
    fetchImpl = async () => ok({ hello: 'world' })

    const result = await new ValhallaIntegration().testConnection(validConfig)

    expect(result).toEqual({
      success: false,
      message: 'Server does not appear to be a Valhalla instance',
    })
  })

  test('reports the status code on an HTTP error', async () => {
    fetchImpl = async () => ({ ok: false, status: 503, statusText: 'Unavailable' })

    const result = await new ValhallaIntegration().testConnection(validConfig)

    expect(result.message).toContain('503')
  })

  test('surfaces a network failure message', async () => {
    fetchImpl = async () => {
      throw new Error('ECONNREFUSED')
    }

    expect(
      (await new ValhallaIntegration().testConnection(validConfig)).message,
    ).toBe('ECONNREFUSED')
  })
})

describe('request assembly', () => {
  test('posts locations as lat/lon objects', async () => {
    await getRoute(configured())(routeRequest() as any)

    expect(calls[0][0]).toBe(`${HOST}/route`)
    expect(bodyOf().locations).toEqual([
      { lat: 35.22, lon: -80.84, type: 'break', heading: undefined },
      { lat: 35.24, lon: -80.82, type: 'break', heading: undefined },
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

  test('maps each travel mode to its costing model', async () => {
    for (const [mode, costing] of [
      [TravelMode.DRIVING, 'auto'],
      [TravelMode.CYCLING, 'bicycle'],
      [TravelMode.WALKING, 'pedestrian'],
      [TravelMode.MOTORCYCLE, 'motorcycle'],
    ] as const) {
      calls = []
      await getRoute(configured())(routeRequest({ mode }) as any)
      expect(bodyOf().costing).toBe(costing)
    }
  })

  test('rejects an unsupported travel mode', async () => {
    await expect(
      getRoute(configured())(routeRequest({ mode: 'teleport' }) as any),
    ).rejects.toThrow('Unsupported travel mode')
  })

  test('maps via waypoints to pass-through locations', async () => {
    // A `through` location does not split the route into a new leg.
    await getRoute(configured())(
      routeRequest({
        waypoints: [
          { coordinate: { lat: 1, lng: 2 }, type: WaypointType.STOP },
          { coordinate: { lat: 3, lng: 4 }, type: WaypointType.VIA },
          { coordinate: { lat: 5, lng: 6 }, type: WaypointType.STOP },
        ],
      }) as any,
    )

    expect(bodyOf().locations.map((l: any) => l.type)).toEqual([
      'break',
      'through',
      'break',
    ])
  })

  test('passes a waypoint heading through', async () => {
    await getRoute(configured())(
      routeRequest({
        waypoints: [
          { coordinate: { lat: 1, lng: 2 }, heading: 90 },
          { coordinate: { lat: 3, lng: 4 } },
        ],
      }) as any,
    )

    expect(bodyOf().locations[0].heading).toBe(90)
  })

  test('requests kilometers and narrative by default', async () => {
    await getRoute(configured())(routeRequest() as any)

    expect(bodyOf().directions_options).toMatchObject({
      units: 'kilometers',
      narrative: true,
      language: 'en',
    })
  })

  test('suppresses the narrative when instructions are not wanted', async () => {
    await getRoute(configured())(
      routeRequest({ includeInstructions: false }) as any,
    )

    expect(bodyOf().directions_options.narrative).toBe(false)
  })

  test('passes a normalized instruction language', async () => {
    await getRoute(configured())(routeRequest({ language: 'es' }) as any)

    expect(bodyOf().directions_options.language).toBe('es')
  })

  test('omits costing options entirely with no preferences or vehicle', async () => {
    await getRoute(configured())(routeRequest() as any)

    expect(bodyOf().costing_options).toBeUndefined()
  })

  test('rethrows a Valhalla error body with its status', async () => {
    fetchImpl = async () => ({
      ok: false,
      status: 400,
      text: async () => 'No path could be found',
    })

    await expect(getRoute(configured())(routeRequest() as any)).rejects.toThrow(
      'Valhalla routing error: 400 - No path could be found',
    )
  })

  test('rethrows a transport failure', async () => {
    fetchImpl = async () => {
      throw new Error('ECONNREFUSED')
    }

    await expect(getRoute(configured())(routeRequest() as any)).rejects.toThrow(
      'Valhalla routing error: ECONNREFUSED',
    )
  })
})

describe('driving costing options', () => {
  const drive = async (preferences: Record<string, unknown>, vehicle?: unknown) => {
    calls = []
    await getRoute(configured())(routeRequest({ preferences, vehicle }) as any)
    return costingOf('auto')
  }

  test('passes a 0–1 range preference straight through', async () => {
    expect(await drive({ tolls: 0.25, highways: 0.75, ferries: 0 })).toMatchObject({
      use_tolls: 0.25,
      use_highways: 0.75,
      use_ferry: 0,
    })
  })

  test('maps a legacy avoid boolean to 0, and its absence to neutral 0.5', async () => {
    // 0.5 is "no opinion"; 1 would actively PREFER tolls.
    expect(await drive({ avoidTolls: true })).toMatchObject({ use_tolls: 0 })
    expect(await drive({ avoidTolls: false })).toMatchObject({ use_tolls: 0.5 })
  })

  test('lets the range preference win over the legacy boolean', async () => {
    expect(await drive({ tolls: 0.9, avoidTolls: true })).toMatchObject({
      use_tolls: 0.9,
    })
  })

  test('excludes unpaved roads on request', async () => {
    expect(await drive({ avoidUnpaved: true })).toMatchObject({
      exclude_unpaved: true,
    })
  })

  test('opts into every HOV lane class together', async () => {
    expect(await drive({ preferHOV: true })).toMatchObject({
      include_hov2: true,
      include_hov3: true,
      include_hot: true,
    })
  })

  test('forwards the vehicle dimensions', async () => {
    expect(
      await drive({}, { height: 2.1, width: 1.9, weight: 3.5 }),
    ).toMatchObject({ height: 2.1, width: 1.9, weight: 3.5 })
  })

  test('forwards a provider-specific top speed', async () => {
    expect(await drive({ providerOptions: { topSpeed: 90 } })).toMatchObject({
      top_speed: 90,
    })
  })

  test('emits no auto block when nothing applies to driving', async () => {
    // Cycling-only preferences must not leak into the auto costing.
    expect(await drive({ cyclingSpeed: 25 })).toBeUndefined()
  })
})

describe('cycling costing options', () => {
  const cycle = async (preferences: Record<string, unknown> = {}) => {
    calls = []
    await getRoute(configured())(
      routeRequest({ mode: TravelMode.CYCLING, preferences }) as any,
    )
    return costingOf('bicycle')
  }

  test('maps hills and ferries onto their Valhalla names', async () => {
    expect(await cycle({ hills: 0.2, ferries: 0.1 })).toMatchObject({
      use_hills: 0.2,
      use_ferry: 0.1,
    })
  })

  test('maps surface quality directly onto avoid_bad_surfaces', async () => {
    expect(await cycle({ surfaceQuality: 0.9 })).toMatchObject({
      avoid_bad_surfaces: 0.9,
    })
  })

  test('maps the legacy paved-path preference to a strong bias', async () => {
    expect(await cycle({ preferPavedPaths: true })).toMatchObject({
      avoid_bad_surfaces: 0.8,
    })
  })

  test('maps safety-vs-speed onto use_roads', async () => {
    // 0 prefers dedicated paths, 1 prefers roads.
    expect(await cycle({ safetyVsSpeed: 0.1 })).toMatchObject({ use_roads: 0.1 })
  })

  test('forwards the cycling speed and bicycle type', async () => {
    expect(await cycle({ cyclingSpeed: 27, bicycleType: 'Road' })).toMatchObject({
      cycling_speed: 27,
      bicycle_type: 'Road',
    })
  })

  test('falls back to the provider options for speed and type', async () => {
    expect(
      await cycle({ providerOptions: { cyclingSpeed: 18, bicycleType: 'Mountain' } }),
    ).toMatchObject({ cycling_speed: 18, bicycle_type: 'Mountain' })
  })

  test('always neutralizes the service-road penalty and allows footways', async () => {
    // These are unconditional tuning, so they appear even with no preferences.
    expect(await cycle()).toMatchObject({
      service_penalty: 0,
      service_factor: 0,
      use_pedestrian_paths: 0.5,
    })
  })
})

describe('walking costing options', () => {
  const walk = async (preferences: Record<string, unknown>) => {
    calls = []
    await getRoute(configured())(
      routeRequest({ mode: TravelMode.WALKING, preferences }) as any,
    )
    return costingOf('pedestrian')
  }

  test('maps hills and lit paths', async () => {
    expect(await walk({ hills: 0.3, litPaths: 0.8 })).toMatchObject({
      use_hills: 0.3,
      use_lit: 0.8,
    })
  })

  test('maps the legacy lit-path preference to a full bias', async () => {
    expect(await walk({ providerOptions: { preferLitPaths: true } })).toMatchObject(
      { use_lit: 1 },
    )
  })

  test('switches the pedestrian type for wheelchair routing', async () => {
    expect(await walk({ wheelchairAccessible: true })).toMatchObject({
      type: 'wheelchair',
    })
  })

  test('forwards the walking speed', async () => {
    expect(await walk({ walkingSpeed: 4.5 })).toMatchObject({ walking_speed: 4.5 })
  })

  test('converts max walk distance to kilometers for max_distance only', async () => {
    // Valhalla's max_distance is in km; the transit limits stay in meters.
    expect(await walk({ maxWalkDistance: 1500 })).toMatchObject({
      max_distance: 1.5,
      transit_start_end_max_distance: 1500,
      transit_transfer_max_distance: 1500,
    })
  })
})

describe('motorcycle costing options', () => {
  const ride = async (preferences: Record<string, unknown>) => {
    calls = []
    await getRoute(configured())(
      routeRequest({ mode: TravelMode.MOTORCYCLE, preferences }) as any,
    )
    return costingOf('motorcycle')
  }

  test('maps the road preferences', async () => {
    expect(await ride({ highways: 0.9, ferries: 0, tolls: 0.5 })).toMatchObject({
      use_highways: 0.9,
      use_ferry: 0,
      use_tolls: 0.5,
    })
  })

  test('forwards the trail preference', async () => {
    expect(await ride({ providerOptions: { useTrails: 0.7 } })).toMatchObject({
      use_trails: 0.7,
    })
  })
})

describe('response mapping', () => {
  test('reports the provider and request id', async () => {
    const route = await getRoute(configured())(
      routeRequest({ requestId: 'req-1' }) as any,
    )

    expect(route.metadata.provider).toBe('valhalla')
    expect(route.metadata.requestId).toBe('req-1')
    expect(route.routes).toHaveLength(1)
  })

  test('converts summary distance from kilometers to meters', async () => {
    const route = await getRoute(configured())(routeRequest() as any)

    expect(route.routes[0].summary.totalDistance).toBe(1500)
    expect(route.routes[0].summary.totalDuration).toBe(420)
  })

  test('carries the toll, highway and ferry flags Valhalla reports', async () => {
    const route = await getRoute(configured())(routeRequest() as any)

    expect(route.routes[0].summary).toMatchObject({
      hasTolls: false,
      hasHighways: true,
      hasFerries: false,
    })
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

  test('builds the bounding box as minLng,minLat,maxLng,maxLat', async () => {
    const route = await getRoute(configured())(routeRequest() as any)

    expect(route.routes[0].boundingBox).toEqual([-80.84, 35.22, -80.82, 35.24])
  })

  test('converts leg distance to meters and pairs the waypoints', async () => {
    const route = await getRoute(configured())(routeRequest() as any)
    const leg = route.routes[0].legs[0]

    expect(leg.distance).toBe(1500)
    expect(leg.startWaypoint.coordinate).toEqual({ lat: 35.22, lng: -80.84 })
    expect(leg.endWaypoint.coordinate).toEqual({ lat: 35.24, lng: -80.82 })
  })
})

describe('polyline decoding', () => {
  test('decodes the shape at precision 6', async () => {
    // Precision 5 would place these coordinates off the coast of Africa.
    const route = await getRoute(configured())(routeRequest() as any)

    expect(route.routes[0].geometry).toEqual([
      { lat: 35.22, lng: -80.84 },
      { lat: 35.23, lng: -80.83 },
      { lat: 35.24, lng: -80.82 },
    ])
  })

  test('returns no geometry for an empty shape', async () => {
    fetchImpl = async () =>
      ok(
        valhallaResponse({
          legs: [
            {
              shape: '',
              summary: { length: 0, time: 0 },
              maneuvers: [],
            },
          ],
        }),
      )

    const route = await getRoute(configured())(routeRequest() as any)

    expect(route.routes[0].legs[0].geometry).toEqual([])
  })
})

describe('instructions', () => {
  const instructionFor = async (maneuver: Record<string, unknown>) => {
    calls = []
    fetchImpl = async () =>
      ok(
        valhallaResponse({
          legs: [
            {
              shape: SHAPE,
              summary: { length: 1.5, time: 420 },
              maneuvers: [
                {
                  type: 1,
                  instruction: 'Go',
                  length: 0.5,
                  time: 60,
                  begin_shape_index: 0,
                  ...maneuver,
                },
              ],
            },
          ],
        }),
      )
    const route = await getRoute(configured())(routeRequest() as any)
    return route.routes[0].legs[0].instructions[0]
  }

  test('carries the narrative text and street name', async () => {
    const instruction = await instructionFor({
      instruction: 'Turn right onto Central Ave.',
      street_names: ['Central Ave', 'NC-27'],
    })

    expect(instruction.text).toBe('Turn right onto Central Ave.')
    expect(instruction.streetName).toBe('Central Ave')
  })

  test('converts instruction distance to meters', async () => {
    expect((await instructionFor({ length: 0.75 })).distance).toBe(750)
  })

  test('anchors the instruction at its shape index', async () => {
    expect((await instructionFor({ begin_shape_index: 2 })).coordinate).toEqual({
      lat: 35.24,
      lng: -80.82,
    })
  })

  test('falls back to null island for an out-of-range shape index', async () => {
    expect((await instructionFor({ begin_shape_index: 99 })).coordinate).toEqual({
      lat: 0,
      lng: 0,
    })
  })

  test('parses a numeric exit number off the sign', async () => {
    expect(
      (await instructionFor({ sign: { exit_number: '23A' } })).exitNumber,
    ).toBe(23)
  })

  test('leaves the exit number unset without a sign', async () => {
    expect((await instructionFor({})).exitNumber).toBeUndefined()
  })

  test('maps the maneuver type families', async () => {
    for (const [type, expected] of [
      [0, 'none'],
      [1, 'start'],
      [9, 'turn'],
      [15, 'continue'],
      [20, 'ramp'],
      [24, 'exit'],
      [26, 'roundabout'],
      [29, 'ferry'],
      [37, 'merge'],
    ] as const) {
      expect((await instructionFor({ type })).type).toBe(expected)
    }
  })

  test('treats an unknown maneuver type as continue', async () => {
    expect((await instructionFor({ type: 99 })).type).toBe('continue')
  })

  test('reports arrival as a destination', async () => {
    // The client keys its arrival flag icon off this exact value, so folding
    // it into the turn family loses the marker at the end of the route.
    expect((await instructionFor({ type: 4 })).type).toBe('destination')
    expect((await instructionFor({ type: 5 })).type).toBe('destination-right')
    expect((await instructionFor({ type: 6 })).type).toBe('destination-left')
  })

  test('distinguishes the sided start maneuvers', async () => {
    expect((await instructionFor({ type: 2 })).type).toBe('start-right')
    expect((await instructionFor({ type: 3 })).type).toBe('start-left')
  })

  test('maps the turn modifiers', async () => {
    for (const [type, expected] of [
      [7, 'slight-left'],
      [8, 'right'],
      [9, 'slight-right'],
      [11, 'u-turn'],
      [12, 'u-turn'],
      [14, 'left'],
      [15, 'straight'],
    ] as const) {
      expect((await instructionFor({ type })).modifier).toBe(expected)
    }
  })

  test('flattens sharp turns onto the plain direction', async () => {
    expect((await instructionFor({ type: 10 })).modifier).toBe('right')
    expect((await instructionFor({ type: 13 })).modifier).toBe('left')
  })

  test('leaves the modifier unset for non-turn maneuvers', async () => {
    expect((await instructionFor({ type: 1 })).modifier).toBeUndefined()
    expect((await instructionFor({ type: 4 })).modifier).toBeUndefined()
  })

  test('shares one table with the Barrelman-proxied adapter', async () => {
    // Both consume the same upstream enum; separate copies drifted apart once
    // already, which is how the unreachable destination branch survived.
    const { mapManeuverType } = await import('../../lib/valhalla-maneuvers')

    expect((await instructionFor({ type: 4 })).type).toBe(mapManeuverType(4))
  })
})
