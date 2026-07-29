/**
 * Unit tests for the Geoapify adapter.
 *
 * Two distinct translations live here. Place adaptation resolves the canonical
 * id: when Geoapify echoes the underlying OSM object (`datasource.raw`), the
 * place must adopt the `osm/<type>/<id>` identity so it merges with the same
 * place from any other source — falling back to a `geoapify/` id would create a
 * duplicate. The single-letter OSM type codes (`n`/`w`/`r`) are expanded on the
 * way through.
 *
 * Route adaptation has to survive Geoapify's optional fields: steps may carry
 * their own geometry or only `from_index`/`to_index` into the route line, and
 * both paths are exercised. Elevation is summed from signed per-step gains, so
 * a negative gain becomes LOSS rather than a negative total.
 *
 * Instruction types arrive as either strings (current API) or numbers (legacy),
 * and the numeric table does not line up with the string one — 4 is a left turn
 * while `'left'` is too, but 2 is a turn with a slight-RIGHT modifier. Both
 * tables are pinned so a future cleanup can't quietly merge them.
 */

import { describe, test, expect, mock } from 'bun:test'

mock.module('../../../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
  logError: () => {},
  logWarn: () => {},
}))

const { GeoapifyAdapter } = await import('./geoapify-adapter')
const adapter = new GeoapifyAdapter()

const feature = (props: Record<string, unknown> = {}, coords = [-80.8431, 35.2271]) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: coords as [number, number] },
  properties: { place_id: 'gp-1', name: 'Amelie’s French Bakery', ...props },
})

/** A route response with one leg and `steps` supplied by the caller. */
const routeResponse = (
  steps: Record<string, unknown>[],
  over: { coordinates?: unknown; type?: string; distance?: number; time?: number } = {},
) => ({
  properties: { time: 420 },
  features: [
    {
      type: 'Feature',
      geometry: {
        type: over.type ?? 'LineString',
        coordinates: over.coordinates ?? [
          [-80.84, 35.22],
          [-80.83, 35.23],
          [-80.82, 35.24],
        ],
      },
      properties: {
        distance: over.distance ?? 1500,
        time: over.time ?? 420,
        legs: [{ distance: over.distance ?? 1500, time: over.time ?? 420, steps }],
      },
    },
  ],
})

const request = (over: Record<string, unknown> = {}) => ({
  waypoints: [
    { coordinate: { lat: 35.22, lng: -80.84 } },
    { coordinate: { lat: 35.24, lng: -80.82 } },
  ],
  mode: 'driving',
  ...over,
})

const step = (over: Record<string, unknown> = {}) => ({
  from_index: 0,
  to_index: 1,
  distance: 750,
  time: 210,
  instruction: { text: 'Head north', type: 'straight' },
  ...over,
})

/** The first route's first leg. */
const firstLeg = (response: any, req: any = request()) =>
  adapter.routing.adaptRouteResponse(response, req as any).routes[0].legs[0]

describe('capability wrappers', () => {
  test('geocoding and autocomplete share the place adapter', () => {
    const input = feature()

    expect(adapter.geocoding.adaptPlaceDetails(input as any)).toEqual(
      adapter.autocomplete.adaptPlaceDetails(input as any),
    )
  })
})

describe('place identity', () => {
  test('adopts the OSM id so the place merges across sources', () => {
    const place = adapter.adaptPlaceDetails(
      feature({ datasource: { raw: { osm_id: 123, osm_type: 'w' } } }) as any,
    )

    expect(place.id).toBe('osm/way/123')
    expect(place.externalIds.osm).toBe('way/123')
  })

  test('expands each single-letter OSM type code', () => {
    for (const [code, expected] of [
      ['n', 'node'],
      ['w', 'way'],
      ['r', 'relation'],
    ] as const) {
      const place = adapter.adaptPlaceDetails(
        feature({ datasource: { raw: { osm_id: 9, osm_type: code } } }) as any,
      )

      expect(place.id).toBe(`osm/${expected}/9`)
    }
  })

  test('assumes a node for an unrecognized type code', () => {
    const place = adapter.adaptPlaceDetails(
      feature({ datasource: { raw: { osm_id: 9, osm_type: 'x' } } }) as any,
    )

    expect(place.id).toBe('osm/node/9')
  })

  test('falls back to a Geoapify id when there is no OSM object', () => {
    // Reverse geocoding omits datasource.raw entirely.
    const place = adapter.adaptPlaceDetails(feature() as any)

    expect(place.id).toBe('geoapify/gp-1')
    expect(place.externalIds.osm).toBeUndefined()
  })

  test('always records the Geoapify place id as an external id', () => {
    expect(adapter.adaptPlaceDetails(feature() as any).externalIds.geoapify).toBe(
      'gp-1',
    )
  })
})

describe('place fields', () => {
  test('reads the coordinates as lng,lat', () => {
    const place = adapter.adaptPlaceDetails(feature() as any)

    expect(place.geometry.value).toEqual({
      type: 'point',
      center: { lat: 35.2271, lng: -80.8431 },
    })
  })

  test('attributes everything to OpenStreetMap, not Geoapify', () => {
    // Geoapify is a lookup service over OSM data; the data itself is OSM's.
    const place = adapter.adaptPlaceDetails(feature() as any)

    expect(place.name.sourceId).toBe('osm')
    expect(place.sources).toEqual([
      { id: 'osm', name: 'OpenStreetMap', url: '' },
    ])
  })

  test('carries a null name rather than inventing one', () => {
    const place = adapter.adaptPlaceDetails(feature({ name: undefined }) as any)

    expect(place.name.value).toBeNull()
  })

  test('reports an unknown place type without raw OSM tags', () => {
    expect(adapter.adaptPlaceDetails(feature() as any).placeType.value).toBe(
      'unknown',
    )
  })

  test('derives the place type from the raw OSM tags', () => {
    const place = adapter.adaptPlaceDetails(
      feature({
        datasource: { raw: { osm_id: 1, osm_type: 'n', amenity: 'cafe' } },
      }) as any,
    )

    expect(place.placeType.value).not.toBe('unknown')
  })

  test('never claims contact details Geoapify does not return', () => {
    const place = adapter.adaptPlaceDetails(feature() as any)

    expect(place.contactInfo).toEqual({
      phone: null,
      email: null,
      website: null,
      socials: {},
    })
    expect(place.photos).toEqual([])
    expect(place.openingHours).toBeNull()
  })
})

describe('address extraction', () => {
  test('joins the house number onto the street', () => {
    const place = adapter.adaptPlaceDetails(
      feature({ housenumber: '2424', street: 'N Davidson St', city: 'Charlotte' }) as any,
    )

    expect(place.address.value.street1).toBe('2424 N Davidson St')
  })

  test('keeps the street alone when there is no house number', () => {
    const place = adapter.adaptPlaceDetails(
      feature({ street: 'N Davidson St' }) as any,
    )

    expect(place.address.value.street1).toBe('N Davidson St')
  })

  test('upper-cases the country code', () => {
    const place = adapter.adaptPlaceDetails(
      feature({ city: 'Charlotte', country_code: 'us' }) as any,
    )

    expect(place.address.value.countryCode).toBe('US')
  })

  test('maps the remaining components onto the unified address', () => {
    const place = adapter.adaptPlaceDetails(
      feature({
        street: 'N Davidson St',
        city: 'Charlotte',
        state: 'North Carolina',
        postcode: '28205',
        country: 'United States',
        formatted: '2424 N Davidson St, Charlotte, NC 28205',
      }) as any,
    )

    expect(place.address.value).toMatchObject({
      locality: 'Charlotte',
      region: 'North Carolina',
      postalCode: '28205',
      country: 'United States',
      formatted: '2424 N Davidson St, Charlotte, NC 28205',
    })
  })

  test('returns no address when every component is missing', () => {
    expect(adapter.adaptPlaceDetails(feature() as any).address).toBeNull()
  })
})

describe('amenities', () => {
  test('indexes the Geoapify categories', () => {
    const place = adapter.adaptPlaceDetails(
      feature({ categories: ['catering', 'catering.cafe'] }) as any,
    )

    expect(place.amenities).toEqual({
      category_0: 'catering',
      category_1: 'catering.cafe',
    })
  })

  test('is empty when there are no categories', () => {
    expect(adapter.adaptPlaceDetails(feature() as any).amenities).toEqual({})
  })
})

describe('malformed input', () => {
  test('falls back to a usable place when adaptation throws', () => {
    // A feature with no geometry blows up in coordinate extraction; the
    // fallback still has to produce something the merge pipeline can hold.
    const place = adapter.adaptPlaceDetails({
      type: 'Feature',
      properties: { place_id: 'gp-2', name: 'Broken' },
    } as any)

    expect(place.id).toBe('geoapify/gp-2')
    expect(place.name.value).toBe('Broken')
    expect(place.geometry.value.center).toEqual({ lat: 0, lng: 0 })
  })

  test('falls back with an unknown id when even the place id is missing', () => {
    const place = adapter.adaptPlaceDetails({ type: 'Feature' } as any)

    expect(place.id).toBe('geoapify/unknown')
  })
})

describe('route adaptation', () => {
  test('reports the provider and processing time', () => {
    const route = adapter.routing.adaptRouteResponse(
      routeResponse([step()]) as any,
      request() as any,
    )

    expect(route.metadata.provider).toBe('geoapify')
    expect(route.metadata.processingTime).toBe(420)
  })

  test('passes the request id through for correlation', () => {
    const route = adapter.routing.adaptRouteResponse(
      routeResponse([step()]) as any,
      request({ requestId: 'req-1' }) as any,
    )

    expect(route.metadata.requestId).toBe('req-1')
  })

  test('converts the route line from lng,lat pairs to coordinates', () => {
    const route = adapter.routing.adaptRouteResponse(
      routeResponse([step()]) as any,
      request() as any,
    )

    expect(route.routes[0].geometry[0]).toEqual({ lng: -80.84, lat: 35.22 })
  })

  test('flattens a MultiLineString into one geometry', () => {
    const route = adapter.routing.adaptRouteResponse(
      routeResponse([step()], {
        type: 'MultiLineString',
        coordinates: [
          [
            [-80.84, 35.22],
            [-80.83, 35.23],
          ],
          [[-80.82, 35.24]],
        ],
      }) as any,
      request() as any,
    )

    expect(route.routes[0].geometry).toHaveLength(3)
  })

  test('computes the bounding box as minLng,minLat,maxLng,maxLat', () => {
    const route = adapter.routing.adaptRouteResponse(
      routeResponse([step()]) as any,
      request() as any,
    )

    expect(route.routes[0].boundingBox).toEqual([-80.84, 35.22, -80.82, 35.24])
  })

  test('summarizes distance and duration from the route properties', () => {
    const route = adapter.routing.adaptRouteResponse(
      routeResponse([step()]) as any,
      request() as any,
    )

    expect(route.routes[0].summary).toMatchObject({
      totalDistance: 1500,
      totalDuration: 420,
    })
  })

  test('claims no toll, highway or ferry knowledge', () => {
    // Geoapify does not report these; guessing would mislead the UI.
    const route = adapter.routing.adaptRouteResponse(
      routeResponse([step()]) as any,
      request() as any,
    )

    expect(route.routes[0].summary).toMatchObject({
      hasTolls: false,
      hasHighways: false,
      hasFerries: false,
    })
  })

  test('derives the arrival time from the departure time', () => {
    const departureTime = new Date('2026-01-01T12:00:00Z')

    const route = adapter.routing.adaptRouteResponse(
      routeResponse([step()]) as any,
      request({ departureTime }) as any,
    )

    expect(route.routes[0].summary.arrivalTime).toEqual(
      new Date('2026-01-01T12:07:00Z'),
    )
  })

  test('leaves the arrival time unset without a departure time', () => {
    const route = adapter.routing.adaptRouteResponse(
      routeResponse([step()]) as any,
      request() as any,
    )

    expect(route.routes[0].summary.arrivalTime).toBeUndefined()
  })
})

describe('leg adaptation', () => {
  test('pairs each leg with its start and end waypoints', () => {
    const leg = firstLeg(routeResponse([step()]))

    expect(leg.startWaypoint.coordinate).toEqual({ lat: 35.22, lng: -80.84 })
    expect(leg.endWaypoint.coordinate).toEqual({ lat: 35.24, lng: -80.82 })
  })

  test('prefers the step’s own geometry when present', () => {
    const leg = firstLeg(
      routeResponse([
        step({
          geometry: { coordinates: [[-80.5, 35.5]] },
        }),
      ]),
    )

    expect(leg.geometry).toEqual([{ lng: -80.5, lat: 35.5 }])
  })

  test('slices the route line by index when the step has no geometry', () => {
    const leg = firstLeg(routeResponse([step({ from_index: 1, to_index: 2 })]))

    expect(leg.geometry).toEqual([
      { lng: -80.83, lat: 35.23 },
      { lng: -80.82, lat: 35.24 },
    ])
  })

  test('stops slicing at the end of the route line', () => {
    // A to_index past the end must not push undefined coordinates.
    const leg = firstLeg(routeResponse([step({ from_index: 2, to_index: 99 })]))

    expect(leg.geometry).toEqual([{ lng: -80.82, lat: 35.24 }])
  })

  test('carries the request’s travel mode onto the leg', () => {
    const leg = firstLeg(routeResponse([step()]), request({ mode: 'cycling' }))

    expect(leg.mode).toBe('cycling')
  })
})

describe('elevation', () => {
  test('sums positive gains and treats negative gains as loss', () => {
    const leg = firstLeg(
      routeResponse([
        step({ elevation_gain: 30 }),
        step({ elevation_gain: -12 }),
        step({ elevation_gain: 20 }),
      ]),
    )

    expect(leg.totalElevationGain).toBe(50)
    expect(leg.totalElevationLoss).toBe(12)
  })

  test('reports the extremes across the steps', () => {
    const leg = firstLeg(
      routeResponse([
        step({ max_elevation: 210, min_elevation: 180 }),
        step({ max_elevation: 260, min_elevation: 150 }),
      ]),
    )

    expect(leg.maxElevation).toBe(260)
    expect(leg.minElevation).toBe(150)
  })

  test('leaves the totals unset when no step reports elevation', () => {
    const leg = firstLeg(routeResponse([step()]))

    expect(leg.totalElevationGain).toBeUndefined()
    expect(leg.totalElevationLoss).toBeUndefined()
    expect(leg.maxElevation).toBeUndefined()
  })

  test('rolls the leg totals up into the route summary', () => {
    const route = adapter.routing.adaptRouteResponse(
      routeResponse([step({ elevation_gain: 30 }), step({ elevation_gain: -10 })]) as any,
      request() as any,
    )

    expect(route.routes[0].summary.totalElevationGain).toBe(30)
    expect(route.routes[0].summary.totalElevationLoss).toBe(10)
  })
})

describe('instructions', () => {
  const instructionsOf = (over: Record<string, unknown>) =>
    firstLeg(routeResponse([step(over)])).instructions[0]

  test('carries the instruction text and distances', () => {
    const instruction = instructionsOf({})

    expect(instruction).toMatchObject({
      text: 'Head north',
      distance: 750,
      duration: 210,
    })
  })

  test('synthesizes text when Geoapify supplies none', () => {
    const instruction = instructionsOf({ instruction: undefined })

    expect(instruction.text).toBe('Continue for 750m')
    expect(instruction.type).toBe('continue')
  })

  test('anchors the instruction at the step’s first coordinate', () => {
    const instruction = instructionsOf({
      geometry: { coordinates: [[-80.5, 35.5]] },
    })

    expect(instruction.coordinate).toEqual({ lng: -80.5, lat: 35.5 })
  })

  test('falls back to the route line at from_index', () => {
    const instruction = instructionsOf({ from_index: 1 })

    expect(instruction.coordinate).toEqual({ lng: -80.83, lat: 35.23 })
  })

  test('falls back to null island when no coordinate can be resolved', () => {
    const instruction = instructionsOf({ from_index: undefined })

    expect(instruction.coordinate).toEqual({ lng: 0, lat: 0 })
  })

  test('passes surface and road class through', () => {
    const instruction = instructionsOf({ surface: 'paved', road_class: 'residential' })

    expect(instruction.surface).toBe('paved')
    expect(instruction.roadClass).toBe('residential')
  })

  test('splits a signed step gain into gain or loss', () => {
    expect(instructionsOf({ elevation_gain: 15 })).toMatchObject({
      elevationGain: 15,
      elevationLoss: undefined,
    })
    expect(instructionsOf({ elevation_gain: -15 })).toMatchObject({
      elevationGain: undefined,
      elevationLoss: 15,
    })
  })
})

describe('instruction type mapping', () => {
  const typeOf = (type: unknown) =>
    firstLeg(routeResponse([step({ instruction: { text: 'x', type } })]))
      .instructions[0]

  test('maps the string API types', () => {
    for (const [type, expected] of [
      ['start', 'start'],
      ['StartAtLeft', 'start'],
      ['left', 'turn'],
      ['SharpRight', 'turn'],
      ['straight', 'continue'],
      ['DestinationReached', 'destination'],
      ['roundabout', 'roundabout'],
      ['ramp', 'ramp'],
    ] as const) {
      expect(typeOf(type).type).toBe(expected)
    }
  })

  test('maps the legacy numeric types', () => {
    for (const [type, expected] of [
      [0, 'start'],
      [1, 'continue'],
      [2, 'turn'],
      [5, 'turn'],
      [6, 'roundabout'],
      [7, 'ramp'],
      [8, 'destination'],
    ] as const) {
      expect(typeOf(type).type).toBe(expected)
    }
  })

  test('treats anything unrecognized as continue', () => {
    expect(typeOf('somethingNew').type).toBe('continue')
    expect(typeOf(99).type).toBe('continue')
  })

  test('maps the string turn modifiers', () => {
    for (const [type, expected] of [
      ['left', 'left'],
      ['right', 'right'],
      ['slightleft', 'slight-left'],
      ['slightright', 'slight-right'],
      ['uturn', 'u-turn'],
      ['straight', 'straight'],
    ] as const) {
      expect(typeOf(type).modifier).toBe(expected)
    }
  })

  test('flattens sharp turns onto the plain direction', () => {
    expect(typeOf('sharpleft').modifier).toBe('left')
    expect(typeOf('sharpright').modifier).toBe('right')
  })

  test('maps the legacy numeric modifiers, which do not match the string table', () => {
    // 4 is a LEFT turn numerically while 'left' is a left turn by name — but 2
    // is slight-right, so the two tables must stay separate.
    for (const [type, expected] of [
      [1, 'straight'],
      [2, 'slight-right'],
      [3, 'right'],
      [4, 'left'],
      [5, 'slight-left'],
    ] as const) {
      expect(typeOf(type).modifier).toBe(expected)
    }
  })

  test('leaves the modifier unset for non-turn instructions', () => {
    expect(typeOf('roundabout').modifier).toBeUndefined()
    expect(typeOf(0).modifier).toBeUndefined()
  })
})
