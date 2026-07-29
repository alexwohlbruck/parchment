/**
 * Unit tests for the Transitland integration.
 *
 * The hard part here is time. GTFS departure times are wall-clock strings in
 * the STOP's timezone and may exceed 24 hours ("25:30:00" is 1:30 am the next
 * day, still counted as the previous service day). `toAbsoluteIso` turns
 * service_date + that string + the IANA zone into a real UTC instant, and it is
 * exercised across DST-stable and DST-shifting zones, past-midnight hours, and
 * the missing-timezone fallback.
 *
 * Departure collection is the other subtlety: `service_date` and
 * `stop_timezone` live on the STOP, not the departure, and station stops nest
 * their platforms under `children`. Missing either means a departure with no
 * absolute timestamp, which the UI renders as a blank arrival.
 *
 * Transitland's own `*_utc` fields are preferred when present — they already
 * handle the 25:xx case correctly, so recomputing would only add a chance to
 * get it wrong.
 */

import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test'

mock.module('../../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
  logError: () => {},
  logWarn: () => {},
}))

const { TransitlandIntegration } = await import('./transitland-integration')

const API_KEY = 'transitland-key'
const validConfig = { apiKey: API_KEY }

function configured() {
  const integration = new TransitlandIntegration()
  integration.initialize(validConfig)
  return integration
}

const realFetch = globalThis.fetch
const realLog = console.log
let calls: string[] = []
let fetchImpl: (url: string) => Promise<any>

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })

/** A departures response for one stop. */
const departuresResponse = (
  departures: Record<string, unknown>[],
  stop: Record<string, unknown> = {},
) => ({
  stops: [
    {
      onestop_id: 's-9q8-stop',
      service_date: '2026-03-14',
      stop_timezone: 'America/New_York',
      departures,
      ...stop,
    },
  ],
})

const departure = (over: Record<string, unknown> = {}) => ({
  departure_time: '14:30:00',
  arrival_time: '14:29:00',
  stop_sequence: 4,
  trip: {
    id: 't-1',
    trip_headsign: 'North to UNCC',
    direction_id: 0,
    route: {
      id: 'r-1',
      route_short_name: 'LYNX',
      route_long_name: 'Blue Line',
      route_type: 0,
      agency: { id: 'a-1', agency_name: 'CATS' },
    },
  },
  ...over,
})

/** The query parameters of the request at `index`. */
const queryOf = (index = 0) => new URL(calls[index]).searchParams

beforeEach(() => {
  calls = []
  fetchImpl = async () => ok({})
  globalThis.fetch = ((url: string) => {
    calls.push(url)
    return fetchImpl(url)
  }) as any
  console.log = () => {}
})

afterEach(() => {
  globalThis.fetch = realFetch
  console.log = realLog
})

describe('configuration', () => {
  test('requires an API key', () => {
    const integration = new TransitlandIntegration()

    expect(integration.validateConfig(validConfig)).toBe(true)
    expect(integration.validateConfig({ apiKey: '' })).toBe(false)
    expect(integration.validateConfig(undefined as any)).toBe(false)
  })

  test('initialize refuses a missing key', () => {
    expect(() =>
      new TransitlandIntegration().initialize({ apiKey: '' }),
    ).toThrow('API key is required')
  })

  test('declares map layer, transit data and place info', () => {
    expect(new TransitlandIntegration().capabilityIds).toEqual([
      'mapLayer',
      'transitData',
      'placeInfo',
    ])
  })

  test('declares the Transitland source', () => {
    expect(new TransitlandIntegration().sources).toEqual(['transitland'])
  })

  test('refuses to fetch before initialization', async () => {
    await expect(
      new TransitlandIntegration().getStop('s-9q8-stop'),
    ).rejects.toThrow('has not been initialized')
    expect(calls).toHaveLength(0)
  })
})

describe('testConnection', () => {
  test('probes a vector tile with the key', async () => {
    fetchImpl = async () => ({ ok: true, status: 200 })

    const result = await new TransitlandIntegration().testConnection(validConfig)

    expect(result).toEqual({ success: true })
    expect(calls[0]).toContain('/tiles/routes/tiles/0/0/0.pbf')
    expect(queryOf().get('apikey')).toBe(API_KEY)
  })

  test('rejects an empty key without a request', async () => {
    const result = await new TransitlandIntegration().testConnection({
      apiKey: '',
    })

    expect(result.success).toBe(false)
    expect(calls).toHaveLength(0)
  })

  test('percent-encodes a key with URL-significant characters', async () => {
    fetchImpl = async () => ({ ok: true, status: 200 })

    await new TransitlandIntegration().testConnection({ apiKey: 'a+b/c=d&e' })

    expect(queryOf().get('apikey')).toBe('a+b/c=d&e')
  })

  test('reports an invalid key on a non-2xx response', async () => {
    fetchImpl = async () => ({ ok: false, status: 401 })

    const result = await new TransitlandIntegration().testConnection(validConfig)

    expect(result).toEqual({
      success: false,
      message: 'Invalid API key or API error',
    })
  })

  test('surfaces a network failure message', async () => {
    fetchImpl = async () => {
      throw new Error('ECONNRESET')
    }

    expect(
      (await new TransitlandIntegration().testConnection(validConfig)).message,
    ).toBe('ECONNRESET')
  })
})

describe('searchStopsNear', () => {
  test('queries by point with a default 100 m radius', async () => {
    fetchImpl = async () => ok({ stops: [{ onestop_id: 's-1' }] })

    const stops = await configured().searchStopsNear(35.2271, -80.8431)

    expect(stops).toHaveLength(1)
    expect(queryOf().get('lat')).toBe('35.2271')
    expect(queryOf().get('lon')).toBe('-80.8431')
    expect(queryOf().get('radius')).toBe('100')
  })

  test('honours an explicit radius', async () => {
    fetchImpl = async () => ok({ stops: [] })

    await configured().searchStopsNear(35.2271, -80.8431, 500)

    expect(queryOf().get('radius')).toBe('500')
  })

  test('adds a name filter only when one is given', async () => {
    fetchImpl = async () => ok({ stops: [] })
    await configured().searchStopsNear(35, -80)
    expect(queryOf().get('search')).toBeNull()

    calls = []
    await configured().searchStopsNear(35, -80, 100, 'Tryon')
    expect(queryOf().get('search')).toBe('Tryon')
  })

  test('returns an empty list on a non-2xx response', async () => {
    fetchImpl = async () => ({ ok: false, status: 500 })

    expect(await configured().searchStopsNear(35, -80)).toEqual([])
  })

  test('returns an empty list on a network failure', async () => {
    fetchImpl = async () => {
      throw new Error('ECONNRESET')
    }

    expect(await configured().searchStopsNear(35, -80)).toEqual([])
  })
})

describe('getDepartures', () => {
  test('fetches the stop’s departures endpoint', async () => {
    fetchImpl = async () => ok(departuresResponse([departure()]))

    const departures = await configured().getDepartures('s-9q8-stop')

    expect(departures).toHaveLength(1)
    expect(calls[0]).toContain('/stops/s-9q8-stop/departures')
  })

  test('percent-encodes an onestop id with a slash', async () => {
    fetchImpl = async () => ok(departuresResponse([]))

    await configured().getDepartures('s-9q8/weird')

    expect(calls[0]).toContain('s-9q8%2Fweird')
  })

  test('passes the time window options through', async () => {
    fetchImpl = async () => ok(departuresResponse([]))

    await configured().getDepartures('s-1', {
      next: 3600,
      startTime: '08:00:00',
      endTime: '09:00:00',
      limit: 5,
    })

    expect(queryOf().get('next')).toBe('3600')
    expect(queryOf().get('start_time')).toBe('08:00:00')
    expect(queryOf().get('end_time')).toBe('09:00:00')
    expect(queryOf().get('limit')).toBe('5')
  })

  test('collects departures from nested platform children', async () => {
    // A station's departures hang off its child platforms.
    fetchImpl = async () =>
      ok({
        stops: [
          {
            service_date: '2026-03-14',
            stop_timezone: 'America/New_York',
            departures: [departure()],
            children: [
              {
                service_date: '2026-03-14',
                stop_timezone: 'America/New_York',
                departures: [departure({ departure_time: '15:00:00' })],
              },
            ],
          },
        ],
      })

    expect(await configured().getDepartures('s-1')).toHaveLength(2)
  })

  test('returns an empty list when the stop has no departures', async () => {
    fetchImpl = async () => ok({ stops: [] })

    expect(await configured().getDepartures('s-1')).toEqual([])
  })

  test('returns an empty list on a non-2xx response', async () => {
    fetchImpl = async () => ({ ok: false, status: 429 })

    expect(await configured().getDepartures('s-1')).toEqual([])
  })

  test('returns an empty list on a network failure', async () => {
    fetchImpl = async () => {
      throw new Error('ECONNRESET')
    }

    expect(await configured().getDepartures('s-1')).toEqual([])
  })
})

describe('departure transformation', () => {
  const firstDeparture = async (
    dep: Record<string, unknown>,
    stop: Record<string, unknown> = {},
  ) => {
    fetchImpl = async () => ok(departuresResponse([departure(dep)], stop))
    return (await configured().getDepartures('s-1'))[0]
  }

  test('maps the trip, route and agency', async () => {
    const result = await firstDeparture({})

    expect(result.trip).toMatchObject({ id: 't-1', headsign: 'North to UNCC' })
    expect(result.route).toMatchObject({
      id: 'r-1',
      shortName: 'LYNX',
      longName: 'Blue Line',
      type: 0,
    })
    expect(result.agency).toMatchObject({ id: 'a-1', name: 'CATS' })
  })

  test('leaves the agency undefined when the route has none', async () => {
    const result = await firstDeparture({
      trip: { id: 't-1', route: { id: 'r-1' } },
    })

    expect(result.agency).toBeUndefined()
  })

  test('prefers estimated realtime times over the schedule', async () => {
    const result = await firstDeparture({
      departure: { scheduled: '14:30:00', estimated: '14:33:00' },
      arrival: { scheduled: '14:29:00', estimated: '14:32:00' },
    })

    expect(result.departureTime).toBe('14:33:00')
    expect(result.scheduledDepartureTime).toBe('14:30:00')
    expect(result.realTime).toBe(true)
  })

  test('is not realtime when only scheduled times are present', async () => {
    expect((await firstDeparture({})).realTime).toBe(false)
  })

  test('reads the delay from whichever field carries it', async () => {
    expect((await firstDeparture({ delay: 120 })).delay).toBe(120)
    expect(
      (await firstDeparture({ arrival: { scheduled: '1:00:00', delay: 60 } }))
        .delay,
    ).toBe(60)
    expect(
      (
        await firstDeparture({
          departure: { scheduled: '1:00:00', estimated_delay: 30 },
        })
      ).delay,
    ).toBe(30)
  })

  test('extracts the destination from a "to" headsign', async () => {
    expect((await firstDeparture({})).direction).toBe('UNCC')
  })

  test('uses the whole headsign when there is no "to"', async () => {
    const result = await firstDeparture({
      trip: { id: 't-1', trip_headsign: 'Linden', route: { id: 'r-1' } },
    })

    expect(result.direction).toBe('Linden')
  })

  test('falls back to the stop headsign', async () => {
    const result = await firstDeparture({
      trip: { id: 't-1', route: { id: 'r-1' } },
      stop_headsign: 'Kimball',
    })

    expect(result.headsign).toBe('Kimball')
    expect(result.direction).toBe('Kimball')
  })

  test('reports an unknown direction with no headsign at all', async () => {
    const result = await firstDeparture({
      trip: { id: 't-1', route: { id: 'r-1' } },
    })

    expect(result.direction).toBe('Unknown')
  })

  test('prefers Transitland’s own UTC timestamps', async () => {
    // They already handle GTFS 25:xx times; recomputing risks getting it wrong.
    const result = await firstDeparture({
      departure: { scheduled: '25:30:00', scheduled_utc: '2026-03-15T05:30:00Z' },
    })

    expect(result.departureAt).toBe('2026-03-15T05:30:00Z')
  })
})

describe('absolute timestamps', () => {
  const departureAt = async (
    time: string,
    stop: Record<string, unknown> = {},
  ) => {
    fetchImpl = async () =>
      ok(departuresResponse([departure({ departure_time: time })], stop))
    return (await configured().getDepartures('s-1'))[0].departureAt
  }

  test('resolves a wall-clock time in the stop’s timezone', async () => {
    // 14:30 EDT on 2026-03-14 is 18:30 UTC.
    expect(await departureAt('14:30:00')).toBe('2026-03-14T18:30:00.000Z')
  })

  test('rolls a GTFS 25:xx time into the next calendar day', async () => {
    // Still service day 2026-03-14, but 01:30 on the 15th locally.
    expect(await departureAt('25:30:00')).toBe('2026-03-15T05:30:00.000Z')
  })

  test('applies the correct offset in a different zone', async () => {
    // 14:30 PDT is 21:30 UTC — three hours later than the same wall time in ET.
    expect(
      await departureAt('14:30:00', { stop_timezone: 'America/Los_Angeles' }),
    ).toBe('2026-03-14T21:30:00.000Z')
  })

  test('treats the time as UTC when the stop has no timezone', async () => {
    expect(await departureAt('14:30:00', { stop_timezone: undefined })).toBe(
      '2026-03-14T14:30:00.000Z',
    )
  })

  test('falls back to the departure’s own service date', async () => {
    // Late-night trips carry service_date on the departure instead.
    fetchImpl = async () =>
      ok(
        departuresResponse(
          [departure({ departure_time: '14:30:00', service_date: '2026-03-20' })],
          { service_date: undefined },
        ),
      )

    const result = (await configured().getDepartures('s-1'))[0]

    expect(result.departureAt).toBe('2026-03-20T18:30:00.000Z')
    expect(result.serviceDate).toBe('2026-03-20')
  })

  test('leaves the timestamp undefined with no service date at all', async () => {
    fetchImpl = async () =>
      ok(departuresResponse([departure()], { service_date: undefined }))

    expect((await configured().getDepartures('s-1'))[0].departureAt).toBeUndefined()
  })

  test('leaves the timestamp undefined for a malformed service date', async () => {
    expect(await departureAt('14:30:00', { service_date: '14/03/2026' })).toBeUndefined()
  })

  test('leaves the timestamp undefined for a malformed time', async () => {
    expect(await departureAt('half past two')).toBeUndefined()
  })

  test('falls back to UTC for an unknown timezone', async () => {
    expect(
      await departureAt('14:30:00', { stop_timezone: 'Mars/Olympus_Mons' }),
    ).toBe('2026-03-14T14:30:00.000Z')
  })

  test('handles a standard-time date in the same zone', async () => {
    // 14:30 EST (November) is 19:30 UTC, an hour later than the EDT case.
    expect(await departureAt('14:30:00', { service_date: '2026-11-14' })).toBe(
      '2026-11-14T19:30:00.000Z',
    )
  })
})

describe('getStop', () => {
  test('returns the first stop from the array', async () => {
    fetchImpl = async () =>
      ok({ stops: [{ onestop_id: 's-1', stop_name: 'Tryon St' }] })

    const stop = await configured().getStop('s-1')

    expect(stop.stop_name).toBe('Tryon St')
    expect(queryOf().get('apikey')).toBe(API_KEY)
  })

  test('returns null for an unknown stop', async () => {
    fetchImpl = async () => ({ ok: false, status: 404 })

    expect(await configured().getStop('s-missing')).toBeNull()
  })

  test('returns null on any other HTTP error', async () => {
    fetchImpl = async () => ({ ok: false, status: 500, statusText: 'Server Error' })

    expect(await configured().getStop('s-1')).toBeNull()
  })

  test('returns null when the response holds no stops', async () => {
    fetchImpl = async () => ok({ stops: [] })

    expect(await configured().getStop('s-1')).toBeNull()
  })

  test('returns null on a network failure', async () => {
    fetchImpl = async () => {
      throw new Error('ECONNRESET')
    }

    expect(await configured().getStop('s-1')).toBeNull()
  })
})

describe('getPlaceInfo', () => {
  const info = (integration: any) => integration.capabilities.placeInfo.getPlaceInfo
  const stop = {
    onestop_id: 's-9q8-tryon',
    stop_name: 'Tryon St Station',
    stop_code: 'TRY',
    stop_desc: 'Uptown platform',
    stop_timezone: 'America/New_York',
    wheelchair_boarding: 1,
    geometry: { type: 'Point', coordinates: [-80.8431, 35.2271] },
  }

  test('adapts a stop into a place', async () => {
    fetchImpl = async () => ok({ stops: [stop] })

    const place = await info(configured())('s-9q8-tryon')

    expect(place.id).toBe('transitland:s-9q8-tryon')
    expect(place.name.value).toBe('Tryon St Station')
    expect(place.placeType.value).toBe('Transit Stop')
  })

  test('reads the coordinates as lng,lat', async () => {
    fetchImpl = async () => ok({ stops: [stop] })

    const place = await info(configured())('s-9q8-tryon')

    expect(place.geometry.value.center).toEqual({ lat: 35.2271, lng: -80.8431 })
  })

  test('falls back to null island with no geometry', async () => {
    fetchImpl = async () => ok({ stops: [{ onestop_id: 's-1' }] })

    const place = await info(configured())('s-1')

    expect(place.geometry.value.center).toEqual({ lat: 0, lng: 0 })
  })

  test('carries the transit details the stop view needs', async () => {
    fetchImpl = async () => ok({ stops: [stop] })

    const place = await info(configured())('s-9q8-tryon')

    expect(place.transit.value).toEqual({
      onestopId: 's-9q8-tryon',
      name: 'Tryon St Station',
      code: 'TRY',
      description: 'Uptown platform',
      timezone: 'America/New_York',
      wheelchairBoarding: 1,
    })
  })

  test('links back to the Transitland stop page', async () => {
    fetchImpl = async () => ok({ stops: [stop] })

    const place = await info(configured())('s-9q8-tryon')

    expect(place.sources[0].url).toBe(
      'https://transit.land/stops/s-9q8-tryon',
    )
    expect(place.externalIds.transitland).toBe('s-9q8-tryon')
  })

  test('returns null when the stop does not exist', async () => {
    fetchImpl = async () => ({ ok: false, status: 404 })

    expect(await info(configured())('s-missing')).toBeNull()
  })
})
