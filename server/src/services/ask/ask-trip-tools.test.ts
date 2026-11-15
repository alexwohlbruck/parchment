import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { PermissionId } from '../../types/auth.types'
import type { TransitItinerary } from '../../types/integration.types'
import type { AskEvent } from '../../types/ask.types'
import type { TripSegment } from '../../types/trip.types'

const mockEstimates = mock(async (_request: unknown) => ({
  walking: 1500,
  transit: 720,
  driving: null,
}))
const mockRoute = mock(async (_request: unknown, _priority?: unknown) => ({
  itineraries: [] as TransitItinerary[],
}))
const mockBarrelman = mock(async () => Response.json({ stations: [] }))
const mockPermissions = mock(async () => [] as string[])
const mockPlanTrip = mock(async (_request: unknown) => ({
  trips: [] as unknown[],
}))

mock.module('../mode-estimates.service', () => ({
  estimateModes: mockEstimates,
}))
mock.module('../transit-routing.service', () => ({
  transitRoutingService: { getIntermodalRoute: mockRoute },
}))
const mockGeocode = mock(
  async (_query: string, _lat?: number, _lng?: number) => ({
    results: [
      {
        name: { value: 'Prospect Park' },
        geometry: { value: { center: { lat: 40.6602, lng: -73.969 } } },
      },
    ],
  }),
)
mock.module('../geocoding.service', () => ({ forwardGeocode: mockGeocode }))
mock.module('../trip.service', () => ({
  multimodalTripService: { planTrip: mockPlanTrip },
}))
mock.module('../barrelman.service', () => ({ requestBarrelman: mockBarrelman }))
mock.module('../auth.service', () => ({
  getPermissions: mockPermissions,
  hasPermission: (granted: string[], id: string) => granted.includes(id),
}))
mock.module('../weather-outlook.service', () => ({
  getWeatherOutlook: async () => null,
}))
mock.module('../integrations', () => ({
  integrationManager: { getConfiguredIntegrationsByCapability: () => [] },
}))

const { tripTools } = await import('./ask-trip-tools')
import type { AskContext } from './ask-tool-base'

const tool = (name: string) => tripTools.find((t) => t.name === name)!
const origin = { lat: 40.7484, lng: -73.9857 }
const to = { lat: 40.7472, lng: -73.9455 }

function context(): AskContext {
  return {
    userId: 'u1',
    language: 'en-US',
    origin,
    places: new Map(),
    units: 'metric',
    vehicles: [],
    now: new Date('2026-11-20T23:00:00Z'),
    seen: new Map(),
    emit: () => {},
  }
}

beforeEach(() => {
  for (const fn of [
    mockEstimates,
    mockRoute,
    mockBarrelman,
    mockPermissions,
    mockPlanTrip,
  ])
    fn.mockClear()
})

describe('travel_times', () => {
  test('needs premium navigation, like the estimates endpoint', async () => {
    await expect(tool('travel_times').run({ to }, context())).rejects.toThrow(
      'Premium',
    )
    expect(mockEstimates).not.toHaveBeenCalled()
  })

  test('reports whole minutes per mode, departing at local time', async () => {
    mockPermissions.mockResolvedValueOnce([PermissionId.PREMIUM_NAVIGATION])
    const result = await tool('travel_times').run(
      { to, depart_at: '2026-11-20T18:30' },
      context(),
    )
    expect(result).toEqual({ walking: 25, transit: 12, driving: null })
    expect(mockEstimates.mock.calls[0][0]).toMatchObject({
      waypoints: [origin, to],
      departureTime: '2026-11-20T23:30:00.000Z',
    })
  })
})

describe('transit_trips', () => {
  const ride = (startTime: string, transitLeg: boolean) => ({
    duration: 1200,
    startTime,
    endTime: startTime,
    walkTime: 0,
    transitTime: 0,
    waitingTime: 0,
    walkDistance: 0,
    transfers: 0,
    legs: [
      {
        mode: transitLeg ? 'SUBWAY' : 'WALK',
        transitLeg,
        from: { name: 'A', lat: 0, lng: 0 },
        to: { name: 'B', lat: 0, lng: 0 },
        startTime,
        endTime: startTime,
        duration: 1200,
        distance: 0,
      },
    ],
  })

  test('reads arrive_by at the destination and drops walk-only results', async () => {
    mockRoute.mockResolvedValueOnce({
      itineraries: [
        ride('2026-11-21T02:00:00Z', false),
        ride('2026-11-21T02:10:00Z', true),
      ] as TransitItinerary[],
    })
    const result = (await tool('transit_trips').run(
      { to, arrive_by: '2026-11-20T22:00' },
      context(),
    )) as any
    expect(mockRoute.mock.calls[0][0]).toMatchObject({
      arriveBy: true,
      time: '2026-11-21T03:00:00.000Z',
    })
    expect(result.searched).toBe('arrive by Fri 22:00')
    expect(result.trips).toHaveLength(1)
    expect(result.trips[0].leave).toBe('Fri 21:10')
  })

  test('says so when nothing runs', async () => {
    await expect(tool('transit_trips').run({ to }, context())).rejects.toThrow(
      'No transit trips',
    )
  })

  test('rejects an unreadable time instead of guessing', async () => {
    await expect(
      tool('transit_trips').run({ to, depart_at: 'later' }, context()),
    ).rejects.toThrow('Unreadable time')
  })
})

test('bikeshare_nearby lists stations nearest first with live counts', async () => {
  mockBarrelman.mockResolvedValueOnce(
    Response.json({
      stations: [
        {
          stationId: 'far',
          name: 'Far',
          lat: 40.752,
          lon: -73.9857,
          numBikesAvailable: 1,
          numDocksAvailable: 9,
          isRenting: true,
          isReturning: true,
        },
        {
          stationId: 'near',
          name: 'Near',
          lat: 40.7486,
          lon: -73.9857,
          numBikesAvailable: 4,
          numEbikesAvailable: 2,
          numDocksAvailable: 3,
          isRenting: true,
          isReturning: true,
        },
      ],
    }),
  )
  const stations = (await tool('bikeshare_nearby').run({}, context())) as any[]
  expect(stations.map((s) => s.name)).toEqual(['Near', 'Far'])
  expect(stations[0]).toMatchObject({
    bikes: 4,
    ebikes: 2,
    docks: 3,
    distance: '20 m',
  })
  expect(stations[1].ebikes).toBe(0)
})

test('weather says when no provider is set up', async () => {
  await expect(tool('weather').run({}, context())).rejects.toThrow(
    'not available',
  )
})

describe('plan_trip', () => {
  const home = { name: 'Home', lat: 40.6727, lng: -73.953 }
  const here = { lat: 40.6662, lng: -73.9603 }

  const segment = (
    mode: string,
    minutes: number,
    details?: TripSegment['details'],
  ) =>
    ({
      mode,
      duration: minutes * 60,
      startTime: '2026-11-20T23:00:00Z',
      endTime: '2026-11-20T23:10:00Z',
      details,
    }) as TripSegment
  const candidate = (segments: TripSegment[], minutes: number) => ({
    trip: {
      segments,
      tripStats: { totalDuration: minutes * 60, totalDistance: 0 },
      earliestStartTime: '2026-11-20T23:00:00Z',
      latestEndTime: '2026-11-20T23:10:00Z',
    },
  })

  function knownContext(events: AskEvent[]) {
    return {
      ...context(),
      places: new Map([
        ['here', here],
        ['home', home],
      ]),
      emit: (event: AskEvent) => events.push(event),
    }
  }

  test('routes between named places and offers the kind asked for in Directions', async () => {
    mockPlanTrip.mockResolvedValueOnce({
      trips: [
        candidate([segment('biking', 5)], 5),
        candidate(
          [
            segment('walking', 3),
            segment('biking', 6, {
              sharedMobilityDetails: {
                provider: 'Citi Bike',
                vehicleType: 'bike',
                stationName: 'Carroll St & Franklin Ave',
                toStationName: 'Sterling Pl & Bedford Ave',
              },
            }),
            segment('walking', 1),
          ],
          10,
        ),
      ],
    })
    const events: AskEvent[] = []
    const result = (await tool('plan_trip').run(
      { from: 'here', to: 'Home', kind: 'bikeshare' },
      knownContext(events),
    )) as any

    expect(
      (mockPlanTrip.mock.calls[0][0] as any).waypoints.map(
        (w: any) => w.location,
      ),
    ).toEqual([here, { lat: home.lat, lng: home.lng }])
    expect(result.trips).toHaveLength(1)
    expect(result.trips[0].steps[1]).toMatchObject({
      pick_up_at: 'Carroll St & Franklin Ave',
      drop_off_at: 'Sterling Pl & Bedford Ave',
      minutes: 6,
    })
    expect(events).toMatchObject([
      { type: 'trip', from: here, to: home, kind: 'bikeshare', tripIndex: 1 },
    ])
    expect((events[0] as any).plan.trips).toHaveLength(2)
  })

  test('an arrive-by time goes on the destination and travels with the trip', async () => {
    mockPlanTrip.mockResolvedValueOnce({
      trips: [candidate([segment('transit', 30)], 30)],
    })
    const events: AskEvent[] = []
    await tool('plan_trip').run(
      { from: 'here', to: 'home', arrive_by: '2026-11-23T09:00' },
      knownContext(events),
    )
    const request = mockPlanTrip.mock.calls[0][0] as any
    expect(request.waypoints[1].arriveBy).toBe('2026-11-23T14:00:00.000Z')
    expect(request.preferredDepartureTime).toBeUndefined()
    expect(events[0]).toMatchObject({
      kind: 'transit',
      time: { mode: 'arriveBy', at: '2026-11-23T14:00:00.000Z' },
    })
  })

  test('for transit, proposes walking to the train over cycling to it', async () => {
    const ride = {
      transitDetails: {
        route: { shortName: '5' },
        departureStop: { name: 'A' },
        arrivalStop: { name: 'B' },
      },
    } as any
    mockPlanTrip.mockResolvedValueOnce({
      trips: [
        candidate(
          [
            segment('biking', 3),
            segment('transit', 10, ride),
            segment('biking', 3),
          ],
          16,
        ),
        candidate(
          [
            segment('walking', 4),
            segment('transit', 10, ride),
            segment('walking', 4),
          ],
          18,
        ),
      ],
    })
    const events: AskEvent[] = []
    await tool('plan_trip').run(
      { from: 'here', to: 'home', kind: 'transit' },
      knownContext(events),
    )
    expect(events[0]).toMatchObject({ tripIndex: 1, lines: ['5'] })
  })

  test('offers the other ways when the kind asked for is not worth it', async () => {
    mockPlanTrip.mockResolvedValueOnce({
      trips: [candidate([segment('walking', 6)], 6)],
    })
    const events: AskEvent[] = []
    const result = (await tool('plan_trip').run(
      { from: 'here', to: 'home', kind: 'bikeshare' },
      knownContext(events),
    )) as any
    expect(result.note).toContain('No bikeshare trip')
    expect(result.trips.map((trip: any) => trip.kind)).toEqual(['walking'])
    expect(events[0]).toMatchObject({ kind: 'walking' })
  })

  test('takes coordinates written as text, and looks up a name near the user', async () => {
    mockPlanTrip.mockResolvedValueOnce({
      trips: [candidate([segment('walking', 17)], 17)],
    })
    const events: AskEvent[] = []
    await tool('plan_trip').run(
      { from: '{"lat": 40.6662, "lng": -73.9603}', to: 'Prospect Park' },
      knownContext(events),
    )

    expect(mockGeocode.mock.calls[0]).toEqual([
      'Prospect Park',
      here.lat,
      here.lng,
    ])
    expect(events[0]).toMatchObject({
      from: here,
      to: { name: 'Prospect Park', lat: 40.6602, lng: -73.969 },
    })
  })
})
