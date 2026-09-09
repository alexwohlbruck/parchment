/**
 * Unit tests for the Valhalla routing adapter.
 *
 * Two conversions carry all the risk. Valhalla reports distances in
 * KILOMETRES while the unified shape is in metres, so every length is ×1000 —
 * missing one shows a 12km drive as 12 metres. And Valhalla's encoded polyline
 * uses precision 6, not the Google-standard 5; decoding at the wrong precision
 * puts the route line 10× off, somewhere in the ocean.
 */

import { describe, test, expect } from 'bun:test'
import { ValhallaAdapter } from './valhalla-adapter'
import { SOURCE } from '../../../lib/constants'

const adapter = new ValhallaAdapter()

/** Build a Valhalla trip response. */
function response(over: Partial<any> = {}): any {
  return {
    trip: {
      legs: [
        {
          shape: '',
          summary: { length: 12.5, time: 900 },
        },
      ],
      locations: [
        { lat: 35.2, lon: -80.8 },
        { lat: 35.3, lon: -80.9 },
      ],
      summary: {
        length: 12.5,
        time: 900,
        min_lat: 35.2,
        min_lon: -80.9,
        max_lat: 35.3,
        max_lon: -80.8,
        has_ferry: false,
        has_highway: true,
        has_toll: false,
        has_time_restrictions: false,
      },
      language: 'en-US',
      units: 'kilometers',
      status: 0,
      status_message: 'OK',
      ...over,
    },
  }
}

const adapt = (r: any, url?: string) => adapter.routing.adaptRouteResponse(r, url)

describe('unit conversion', () => {
  test('converts leg length from kilometres to metres', () => {
    const route = adapt(response())

    expect(route.legs[0].distance).toBe(12500)
    expect(route.legs[0].summary.length).toBe(12500)
  })

  test('converts the trip summary distance to metres', () => {
    expect(adapt(response()).summary.distance).toBe(12500)
  })

  test('leaves times in seconds', () => {
    const route = adapt(response())

    expect(route.legs[0].time).toBe(900)
    expect(route.summary.time).toBe(900)
  })

  test('handles a sub-kilometre leg without losing precision', () => {
    const route = adapt(
      response({ legs: [{ shape: '', summary: { length: 0.25, time: 60 } }] }),
    )

    expect(route.legs[0].distance).toBe(250)
  })
})

describe('polyline decoding', () => {
  test('decodes at precision 6, not the Google-standard 5', () => {
    // `_p~iF~ps|U` decodes to (38.5, -120.2) at precision 5; at precision 6 the
    // same string is (3.85, -12.02). Reading it at the wrong precision puts the
    // route line 10× away from the real one.
    const route = adapt(
      response({ legs: [{ shape: '_p~iF~ps|U', summary: { length: 1, time: 60 } }] }),
    )

    expect(route.legs[0].geometry[0].lat).toBeCloseTo(3.85, 5)
    expect(route.legs[0].geometry[0].lng).toBeCloseTo(-12.02, 5)
  })

  test('decodes a multi-point shape', () => {
    const route = adapt(
      response({
        legs: [{ shape: '_p~iF~ps|U_ulLnnqC', summary: { length: 1, time: 60 } }],
      }),
    )

    expect(route.legs[0].geometry.length).toBe(2)
  })

  test('returns an empty geometry for an empty shape', () => {
    expect(adapt(response()).legs[0].geometry).toEqual([])
  })

  test('keeps the raw encoded shape alongside the decoded points', () => {
    const route = adapt(
      response({ legs: [{ shape: '_p~iF~ps|U', summary: { length: 1, time: 60 } }] }),
    )

    expect(route.legs[0].shape).toBe('_p~iF~ps|U')
  })
})

describe('locations and summary', () => {
  test('renames Valhalla’s lon to lng', () => {
    const route = adapt(response())

    expect(route.locations).toEqual([
      { lat: 35.2, lng: -80.8 },
      { lat: 35.3, lng: -80.9 },
    ])
  })

  test('maps the bounding box', () => {
    expect(adapt(response()).summary.bounds).toEqual({
      minLat: 35.2,
      minLng: -80.9,
      maxLat: 35.3,
      maxLng: -80.8,
    })
  })

  test('carries the route characteristic flags through', () => {
    const route = adapt(
      response({
        summary: {
          length: 1,
          time: 60,
          min_lat: 0,
          min_lon: 0,
          max_lat: 1,
          max_lon: 1,
          has_ferry: true,
          has_highway: false,
          has_toll: true,
          has_time_restrictions: true,
        },
      }),
    )

    expect(route.summary).toMatchObject({
      hasFerry: true,
      hasHighway: false,
      hasToll: true,
      hasTimeRestrictions: true,
    })
  })
})

describe('envelope', () => {
  test('attributes the route to Valhalla', () => {
    const route = adapt(response(), 'https://valhalla.test/route')

    expect(route.source).toEqual({
      id: SOURCE.VALHALLA,
      name: 'Valhalla',
      url: 'https://valhalla.test/route',
    })
  })

  test('leaves the source URL undefined when not supplied', () => {
    expect(adapt(response()).source.url).toBeUndefined()
  })

  test('passes the status through', () => {
    const route = adapt(response({ status: 0, status_message: 'OK' }))

    expect(route.status).toEqual({ code: 0, message: 'OK' })
  })

  test('defaults status to OK when absent', () => {
    const route = adapt(
      response({ status: undefined, status_message: undefined }),
    )

    expect(route.status).toEqual({ code: 0, message: 'OK' })
  })

  test('defaults language and units', () => {
    const route = adapt(response({ language: undefined, units: undefined }))

    expect(route.language).toBe('en-US')
    expect(route.units).toBe('kilometers')
  })

  test('keeps the raw response for debugging', () => {
    const payload = response()

    expect(adapt(payload).raw).toBe(payload)
  })

  test('emits no maneuvers yet', () => {
    // Turn-by-turn is not wired up; the field must still be an array.
    expect(adapt(response()).legs[0].maneuvers).toEqual([])
  })

  test('handles a multi-leg trip', () => {
    const route = adapt(
      response({
        legs: [
          { shape: '', summary: { length: 1, time: 60 } },
          { shape: '', summary: { length: 2, time: 120 } },
        ],
      }),
    )

    expect(route.legs).toHaveLength(2)
    expect(route.legs[1].distance).toBe(2000)
  })
})
