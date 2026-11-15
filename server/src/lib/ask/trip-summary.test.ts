import { describe, test, expect } from 'bun:test'
import {
  localClock,
  parseTripTime,
  summarizeItinerary,
  summarizeTrip,
} from './trip-summary'
import type {
  TransitItinerary,
  TransitLeg,
} from '../../types/integration.types'
import type { TripResponse, TripSegment } from '../../types/trip.types'

const NY = 'America/New_York'

function leg(overrides: Partial<TransitLeg>): TransitLeg {
  return {
    mode: 'WALK',
    from: { name: 'Start', lat: 0, lng: 0 },
    to: { name: 'End', lat: 0, lng: 0 },
    startTime: '2026-11-21T02:40:00Z',
    endTime: '2026-11-21T02:45:00Z',
    duration: 300,
    distance: 400,
    transitLeg: false,
    ...overrides,
  }
}

describe('parseTripTime', () => {
  test('reads a time without an offset as wall-clock time where the trip is', () => {
    expect(parseTripTime('2026-11-20T21:45', NY)?.toISOString()).toBe(
      '2026-11-21T02:45:00.000Z',
    )
    expect(parseTripTime('2026-07-20T21:45', NY)?.toISOString()).toBe(
      '2026-07-21T01:45:00.000Z',
    )
  })

  test('keeps an explicit offset', () => {
    expect(parseTripTime('2026-11-20T21:45:00Z', NY)?.toISOString()).toBe(
      '2026-11-20T21:45:00.000Z',
    )
  })

  test('rejects nonsense', () => {
    expect(parseTripTime('after dinner', NY)).toBeNull()
  })
})

describe('summarizeItinerary', () => {
  const trip: TransitItinerary = {
    duration: 1980,
    startTime: '2026-11-21T02:40:00Z',
    endTime: '2026-11-21T03:13:00Z',
    walkTime: 480,
    transitTime: 1500,
    waitingTime: 0,
    walkDistance: 600,
    transfers: 0,
    fare: { currency: 'USD', amount: 2.9 },
    legs: [
      leg({}),
      leg({
        mode: 'SUBWAY',
        transitLeg: true,
        routeShortName: '7',
        headsign: 'Flushing-Main St',
        from: { name: 'Times Sq-42 St', lat: 0, lng: 0 },
        to: { name: 'Court Sq', lat: 0, lng: 0 },
        startTime: '2026-11-21T02:47:00Z',
        endTime: '2026-11-21T03:05:00Z',
        realTime: true,
        departureDelay: 180,
      }),
    ],
  }

  test('gives local times, minutes and only the rides', () => {
    expect(summarizeItinerary(trip, NY)).toEqual({
      leave: 'Fri 21:40',
      arrive: 'Fri 22:13',
      minutes: 33,
      transfers: 0,
      walk_minutes: 8,
      fare: '2.90 USD',
      rides: [
        {
          line: '7',
          toward: 'Flushing-Main St',
          board: 'Times Sq-42 St',
          alight: 'Court Sq',
          depart: 'Fri 21:47',
          arrive: 'Fri 22:05',
          live: true,
          late_minutes: 3,
        },
      ],
    })
  })

  test('an early departure is not reported as late', () => {
    const early = { ...trip, legs: [{ ...trip.legs[1], departureDelay: -60 }] }
    expect(summarizeItinerary(early, NY).rides[0]).not.toHaveProperty(
      'late_minutes',
    )
  })
})

test('localClock falls back to UTC without a zone', () => {
  expect(localClock('2026-11-21T02:40:00Z', null)).toBe('Sat 02:40')
})

describe('summarizeTrip', () => {
  const at = '2026-11-21T02:40:00Z'
  const segment = (
    mode: string,
    minutes: number,
    details?: TripSegment['details'],
  ) =>
    ({
      mode,
      duration: minutes * 60,
      startTime: at,
      endTime: at,
      details,
    }) as TripSegment
  const trip = (segments: TripSegment[]) =>
    ({
      segments,
      tripStats: { totalDuration: 1200, totalDistance: 0 },
      earliestStartTime: at,
      latestEndTime: '2026-11-21T03:00:00Z',
    }) as TripResponse

  test('a bike share ride to a train is a transit trip, read as the moves made', () => {
    const summary = summarizeTrip(
      trip([
        segment('biking', 6, {
          sharedMobilityDetails: {
            provider: 'Citi Bike',
            vehicleType: 'ebike',
            stationName: 'A',
            toStationName: 'B',
            availableDocks: 15,
          },
        }),
        segment('transit', 12, {
          transitDetails: {
            route: { shortName: 'G' },
            headsign: 'Court Sq',
            departureStop: { name: 'Bedford-Nostrand Avs' },
            arrivalStop: { name: 'Court Sq' },
          } as any,
        }),
      ]),
      NY,
    )
    expect(summary).toEqual({
      kind: 'transit',
      minutes: 20,
      leave: 'Fri 21:40',
      arrive: 'Fri 22:00',
      steps: [
        {
          move: 'ride a Citi Bike ebike',
          pick_up_at: 'A',
          drop_off_at: 'B',
          minutes: 6,
          docks_at_drop_off: 15,
        },
        {
          move: 'ride transit',
          line: 'G',
          toward: 'Court Sq',
          board: 'Bedford-Nostrand Avs',
          alight: 'Court Sq',
          depart: 'Fri 21:40',
          minutes: 12,
        },
      ],
    })
  })

  test('reads mixed segments through to their parts', () => {
    const mixed = segment('mixed', 10, {
      multimodalSegments: [
        segment('walking', 2),
        segment('biking', 8, {
          sharedMobilityDetails: { provider: 'Citi Bike', vehicleType: 'bike' },
        }),
      ],
    })
    expect(summarizeTrip(trip([mixed]), NY).kind).toBe('bikeshare')
  })
})
