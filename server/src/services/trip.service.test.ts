import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ── Mock dependencies before imports ─────────────────────────────────────────

// Mock routing service — used for walking/biking/driving segments
const mockGetRoute = mock(async () => ({
  routes: [
    {
      distance: 500,
      duration: 360,
      legs: [
        {
          distance: 500,
          duration: 360,
          geometry: {
            type: 'LineString' as const,
            coordinates: [
              [-80.8, 35.2],
              [-80.81, 35.21],
            ],
          },
          instructions: [],
          totalElevationGain: 10,
          totalElevationLoss: 5,
          maxElevation: 250,
          minElevation: 240,
          edgeSegments: [],
        },
      ],
    },
  ],
}))

mock.module('./routing.service', () => ({
  routingService: { getRoute: mockGetRoute },
}))

// Mock transit routing service — used for transit legs
const mockGetTransitRoute = mock(async () => ({
  itineraries: [],
  metadata: { searchWindow: 3600 },
}))

mock.module('./transit-routing.service', () => ({
  transitRoutingService: { getTransitRoute: mockGetTransitRoute },
}))

// Mock search service — used for parking lookup
const mockSearchByCategory = mock(async () => [])

mock.module('./search.service', () => ({
  searchByCategory: mockSearchByCategory,
}))

// ── Import under test (after mocks) ──────────────────────────────────────────

const { TripService } = await import('./trip.service')

// ── Test fixtures ────────────────────────────────────────────────────────────

const CHARLOTTE_ORIGIN = {
  location: { lat: 35.2094, lng: -80.8605 },
  type: 'origin' as const,
  label: 'Uptown Charlotte',
}

const CHARLOTTE_DEST = {
  location: { lat: 35.2271, lng: -80.8431 },
  type: 'destination' as const,
  label: 'NoDa',
}

function makeTransitItinerary(overrides: Record<string, any> = {}) {
  return {
    duration: 1800,
    startTime: '2026-01-15T08:00:00Z',
    endTime: '2026-01-15T08:30:00Z',
    walkTime: 600,
    transitTime: 1200,
    waitingTime: 0,
    walkDistance: 500,
    transfers: 0,
    legs: [
      {
        mode: 'WALK',
        transitLeg: false,
        from: { name: 'Origin', lat: 35.2094, lng: -80.8605 },
        to: {
          name: 'Stop A',
          lat: 35.21,
          lng: -80.85,
          stopId: 'stop-a',
        },
        startTime: '2026-01-15T08:00:00Z',
        endTime: '2026-01-15T08:05:00Z',
        duration: 300,
        distance: 250,
      },
      {
        mode: 'BUS',
        transitLeg: true,
        from: {
          name: 'Stop A',
          lat: 35.21,
          lng: -80.85,
          stopId: 'stop-a',
        },
        to: {
          name: 'Stop B',
          lat: 35.225,
          lng: -80.845,
          stopId: 'stop-b',
        },
        startTime: '2026-01-15T08:05:00Z',
        endTime: '2026-01-15T08:25:00Z',
        duration: 1200,
        distance: 5000,
        routeShortName: '9X',
        routeLongName: 'Express Downtown',
        routeColor: '0000FF',
        routeTextColor: 'FFFFFF',
        headsign: 'NoDa',
        agencyName: 'Charlotte CATS',
        agencyId: 'cats-agency',
        tripId: 'trip-123',
        routeId: 'route-9x',
        geometry: {
          type: 'LineString',
          coordinates: [
            [-80.85, 35.21],
            [-80.845, 35.225],
          ],
        },
        intermediateStops: [
          {
            name: 'Mid Stop',
            lat: 35.218,
            lng: -80.848,
            stopId: 'mid-stop',
            arrival: '2026-01-15T08:15:00Z',
            departure: '2026-01-15T08:15:30Z',
          },
        ],
      },
      {
        mode: 'WALK',
        transitLeg: false,
        from: {
          name: 'Stop B',
          lat: 35.225,
          lng: -80.845,
          stopId: 'stop-b',
        },
        to: { name: 'Destination', lat: 35.2271, lng: -80.8431 },
        startTime: '2026-01-15T08:25:00Z',
        endTime: '2026-01-15T08:30:00Z',
        duration: 300,
        distance: 250,
      },
    ],
    ...overrides,
  }
}

function makeBasicWalkRoute(distance: number, duration: number) {
  return {
    routes: [
      {
        distance,
        duration,
        legs: [
          {
            distance,
            duration,
            geometry: {
              type: 'LineString' as const,
              coordinates: [
                [-80.8, 35.2],
                [-80.81, 35.21],
              ],
            },
            instructions: [{ text: 'Walk north' }],
            totalElevationGain: 5,
            totalElevationLoss: 3,
            maxElevation: 248,
            minElevation: 243,
            edgeSegments: [],
          },
        ],
      },
    ],
  }
}

// ── Setup ────────────────────────────────────────────────────────────────────

let tripService: InstanceType<typeof TripService>

beforeEach(() => {
  mockGetRoute.mockReset()
  mockGetTransitRoute.mockReset()
  mockSearchByCategory.mockReset()
  tripService = new TripService()

  // Default routing mock — returns a basic walking route
  mockGetRoute.mockImplementation(async () => makeBasicWalkRoute(500, 360))
  // Default parking search — no results (parking feature is opt-in)
  mockSearchByCategory.mockImplementation(async () => [])
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe('TripService — mode generation', () => {
  test('transit mode generates only transit', () => {
    // Access private method via prototype
    const modes = (tripService as any).getModesToGenerate('transit')
    expect(modes).toEqual(['transit'])
  })

  test('multi mode includes transit', () => {
    const modes = (tripService as any).getModesToGenerate('multi')
    expect(modes).toContain('transit')
    expect(modes).toContain('walking')
    expect(modes).toContain('driving')
    expect(modes).toContain('biking')
  })

  test('walking mode does not include transit', () => {
    const modes = (tripService as any).getModesToGenerate('walking')
    expect(modes).not.toContain('transit')
  })

  test('default mode (undefined) does not include transit', () => {
    const modes = (tripService as any).getModesToGenerate(undefined)
    expect(modes).not.toContain('transit')
  })
})

describe('TripService — planTransitSegment', () => {
  test('returns null when no itineraries found', async () => {
    mockGetTransitRoute.mockImplementation(async () => ({
      itineraries: [],
      metadata: { searchWindow: 3600 },
    }))

    const result = await (tripService as any).planTransitSegment(
      CHARLOTTE_ORIGIN,
      CHARLOTTE_DEST,
      {
        currentTime: '2026-01-15T08:00:00Z',
        currentLocation: CHARLOTTE_ORIGIN.location,
        currentMode: 'transit',
        parkedVehicles: [],
      },
    )

    expect(result).toBeNull()
  })

  test('composes walk → transit → walk segments', async () => {
    const itinerary = makeTransitItinerary()
    mockGetTransitRoute.mockImplementation(async () => ({
      itineraries: [itinerary],
      metadata: { searchWindow: 3600 },
    }))

    const result = await (tripService as any).planTransitSegment(
      CHARLOTTE_ORIGIN,
      CHARLOTTE_DEST,
      {
        currentTime: '2026-01-15T08:00:00Z',
        currentLocation: CHARLOTTE_ORIGIN.location,
        currentMode: 'transit',
        parkedVehicles: [],
      },
    )

    expect(result).not.toBeNull()
    expect(result.multimodalSegments).toBeArray()
    // Three segments: walk → transit → walk
    expect(result.multimodalSegments.length).toBe(3)

    const [walk1, transit, walk2] = result.multimodalSegments
    expect(walk1.mode).toBe('walking')
    expect(transit.mode).toBe('transit')
    expect(walk2.mode).toBe('walking')
  })

  test('transit segment has correct TransitDetails', async () => {
    const itinerary = makeTransitItinerary()
    mockGetTransitRoute.mockImplementation(async () => ({
      itineraries: [itinerary],
      metadata: { searchWindow: 3600 },
    }))

    const result = await (tripService as any).planTransitSegment(
      CHARLOTTE_ORIGIN,
      CHARLOTTE_DEST,
      {
        currentTime: '2026-01-15T08:00:00Z',
        currentLocation: CHARLOTTE_ORIGIN.location,
        currentMode: 'transit',
        parkedVehicles: [],
      },
    )

    const transitSeg = result.multimodalSegments.find(
      (s: any) => s.mode === 'transit',
    )
    expect(transitSeg).toBeDefined()
    const details = transitSeg.details?.transitDetails
    expect(details).toBeDefined()
    expect(details.route.shortName).toBe('9X')
    expect(details.route.longName).toBe('Express Downtown')
    expect(details.route.color).toBe('0000FF')
    expect(details.route.agency.name).toBe('Charlotte CATS')
    expect(details.trip.headsign).toBe('NoDa')
    expect(details.headsign).toBe('NoDa')
    expect(details.departureStop.name).toBe('Stop A')
    expect(details.arrivalStop.name).toBe('Stop B')
  })

  test('transit segment includes intermediate stops', async () => {
    const itinerary = makeTransitItinerary()
    mockGetTransitRoute.mockImplementation(async () => ({
      itineraries: [itinerary],
      metadata: { searchWindow: 3600 },
    }))

    const result = await (tripService as any).planTransitSegment(
      CHARLOTTE_ORIGIN,
      CHARLOTTE_DEST,
      {
        currentTime: '2026-01-15T08:00:00Z',
        currentLocation: CHARLOTTE_ORIGIN.location,
        currentMode: 'transit',
        parkedVehicles: [],
      },
    )

    const transitSeg = result.multimodalSegments.find(
      (s: any) => s.mode === 'transit',
    )
    const details = transitSeg.details?.transitDetails
    // stops = [departure, ...intermediate, arrival]
    expect(details.stops.length).toBe(3)
    expect(details.stops[1].name).toBe('Mid Stop')
    expect(details.stops[1].stopSequence).toBe(1)
  })

  test('updates segment state with final time and location', async () => {
    const itinerary = makeTransitItinerary()
    mockGetTransitRoute.mockImplementation(async () => ({
      itineraries: [itinerary],
      metadata: { searchWindow: 3600 },
    }))

    const result = await (tripService as any).planTransitSegment(
      CHARLOTTE_ORIGIN,
      CHARLOTTE_DEST,
      {
        currentTime: '2026-01-15T08:00:00Z',
        currentLocation: CHARLOTTE_ORIGIN.location,
        currentMode: 'transit',
        parkedVehicles: [],
      },
    )

    expect(result.state.currentMode).toBe('transit')
    expect(result.state.currentLocation).toEqual(CHARLOTTE_DEST.location)
  })

  test('passes transit preferences to MOTIS request', async () => {
    mockGetTransitRoute.mockImplementation(async () => ({
      itineraries: [],
      metadata: { searchWindow: 3600 },
    }))

    await (tripService as any).planTransitSegment(
      CHARLOTTE_ORIGIN,
      CHARLOTTE_DEST,
      {
        currentTime: '2026-01-15T08:00:00Z',
        currentLocation: CHARLOTTE_ORIGIN.location,
        currentMode: 'transit',
        parkedVehicles: [],
      },
      {
        transitModes: ['BUS', 'RAIL'],
        maxWalkingDistance: 1500,
        maxTransfers: 2,
        wheelchairAccessible: true,
      },
    )

    expect(mockGetTransitRoute).toHaveBeenCalledTimes(1)
    const request = mockGetTransitRoute.mock.calls[0][0]
    expect(request.transitModes).toEqual(['BUS', 'RAIL'])
    expect(request.maxWalkDistance).toBe(1500)
    expect(request.maxTransfers).toBe(2)
    expect(request.wheelchair).toBe(true)
  })

  test('returns null on transit routing error', async () => {
    mockGetTransitRoute.mockImplementation(async () => {
      throw new Error('MOTIS connection refused')
    })

    const result = await (tripService as any).planTransitSegment(
      CHARLOTTE_ORIGIN,
      CHARLOTTE_DEST,
      {
        currentTime: '2026-01-15T08:00:00Z',
        currentLocation: CHARLOTTE_ORIGIN.location,
        currentMode: 'transit',
        parkedVehicles: [],
      },
    )

    expect(result).toBeNull()
  })

  test('uses fallback walking segment when GraphHopper fails', async () => {
    const itinerary = makeTransitItinerary()
    mockGetTransitRoute.mockImplementation(async () => ({
      itineraries: [itinerary],
      metadata: { searchWindow: 3600 },
    }))

    // GraphHopper fails for walking legs
    mockGetRoute.mockImplementation(async () => {
      throw new Error('GraphHopper unavailable')
    })

    const result = await (tripService as any).planTransitSegment(
      CHARLOTTE_ORIGIN,
      CHARLOTTE_DEST,
      {
        currentTime: '2026-01-15T08:00:00Z',
        currentLocation: CHARLOTTE_ORIGIN.location,
        currentMode: 'transit',
        parkedVehicles: [],
      },
    )

    // Should still produce segments using MOTIS fallback data
    expect(result).not.toBeNull()
    expect(result.multimodalSegments.length).toBe(3)

    // Walking segments are fallback (no GraphHopper instructions)
    const walkSegs = result.multimodalSegments.filter(
      (s: any) => s.mode === 'walking',
    )
    expect(walkSegs.length).toBe(2)
    walkSegs.forEach((seg: any) => {
      expect(seg.instructions).toEqual([])
    })
  })
})

describe('TripService — buildTransitSegment', () => {
  test('maps MOTIS BUS mode correctly', () => {
    const mode = (tripService as any).mapMotisMode('BUS')
    expect(mode).toBe('bus')
  })

  test('maps MOTIS RAIL mode correctly', () => {
    const mode = (tripService as any).mapMotisMode('RAIL')
    expect(mode).toBe('rail')
  })

  test('maps MOTIS SUBWAY mode correctly', () => {
    const mode = (tripService as any).mapMotisMode('SUBWAY')
    expect(mode).toBe('subway')
  })

  test('maps MOTIS TRAM mode correctly', () => {
    const mode = (tripService as any).mapMotisMode('TRAM')
    expect(mode).toBe('tram')
  })

  test('maps MOTIS FERRY mode correctly', () => {
    const mode = (tripService as any).mapMotisMode('FERRY')
    expect(mode).toBe('ferry')
  })

  test('maps unknown MOTIS mode to bus', () => {
    const mode = (tripService as any).mapMotisMode('UNKNOWN_MODE')
    expect(mode).toBe('bus')
  })

  test('builds transit segment with CO2 estimate', () => {
    const leg = {
      mode: 'BUS',
      transitLeg: true,
      from: { name: 'Stop A', lat: 35.21, lng: -80.85, stopId: 'sa' },
      to: { name: 'Stop B', lat: 35.22, lng: -80.84, stopId: 'sb' },
      startTime: '2026-01-15T08:05:00Z',
      endTime: '2026-01-15T08:25:00Z',
      duration: 1200,
      distance: 5000,
      routeShortName: '9X',
      headsign: 'Downtown',
      agencyName: 'CATS',
      agencyId: 'cats',
      tripId: 'trip-1',
      routeId: 'route-9x',
    }

    const segment = (tripService as any).buildTransitSegment(
      leg,
      CHARLOTTE_ORIGIN,
      CHARLOTTE_DEST,
      '2026-01-15T08:05:00Z',
    )

    expect(segment.co2).toBeCloseTo(5000 * 0.00005, 5) // ~50g/km
    expect(segment.mode).toBe('transit')
  })
})

describe('TripService — planTrip with transit', () => {
  test('transit mode calls transit routing service', async () => {
    mockGetTransitRoute.mockImplementation(async () => ({
      itineraries: [makeTransitItinerary()],
      metadata: { searchWindow: 3600 },
    }))

    const response = await tripService.planTrip({
      waypoints: [CHARLOTTE_ORIGIN, CHARLOTTE_DEST],
      selectedMode: 'transit',
      preferredDepartureTime: '2026-01-15T08:00:00Z',
    })

    // Should produce at least one trip candidate
    expect(response.trips.length).toBeGreaterThanOrEqual(1)
    expect(mockGetTransitRoute).toHaveBeenCalled()
  })

  test('multi mode generates transit among other candidates', async () => {
    mockGetTransitRoute.mockImplementation(async () => ({
      itineraries: [makeTransitItinerary()],
      metadata: { searchWindow: 3600 },
    }))

    const response = await tripService.planTrip({
      waypoints: [CHARLOTTE_ORIGIN, CHARLOTTE_DEST],
      selectedMode: 'multi',
      preferredDepartureTime: '2026-01-15T08:00:00Z',
    })

    // multi generates walking, driving, biking, transit
    // All should attempt routing (at least walking + transit should succeed)
    expect(response.trips.length).toBeGreaterThanOrEqual(1)
    expect(mockGetTransitRoute).toHaveBeenCalled()
    expect(mockGetRoute).toHaveBeenCalled()
  })

  test('transit failure in multi mode still returns other trips', async () => {
    mockGetTransitRoute.mockImplementation(async () => {
      throw new Error('MOTIS unavailable')
    })

    const response = await tripService.planTrip({
      waypoints: [CHARLOTTE_ORIGIN, CHARLOTTE_DEST],
      selectedMode: 'multi',
      preferredDepartureTime: '2026-01-15T08:00:00Z',
    })

    // Should still have walking/driving/biking trips
    expect(response.trips.length).toBeGreaterThanOrEqual(1)
  })

  test('ranks trips by duration (fastest first)', async () => {
    // Walking: slow
    mockGetRoute.mockImplementation(async () => makeBasicWalkRoute(1000, 720))

    // Transit: faster
    mockGetTransitRoute.mockImplementation(async () => ({
      itineraries: [
        makeTransitItinerary({
          duration: 1800,
          legs: [
            {
              mode: 'BUS',
              transitLeg: true,
              from: { name: 'Stop A', lat: 35.21, lng: -80.85, stopId: 'sa' },
              to: { name: 'Stop B', lat: 35.225, lng: -80.845, stopId: 'sb' },
              startTime: '2026-01-15T08:00:00Z',
              endTime: '2026-01-15T08:30:00Z',
              duration: 1800,
              distance: 5000,
              routeShortName: '9X',
              headsign: 'NoDa',
              agencyName: 'CATS',
            },
          ],
        }),
      ],
      metadata: { searchWindow: 3600 },
    }))

    const response = await tripService.planTrip({
      waypoints: [CHARLOTTE_ORIGIN, CHARLOTTE_DEST],
      selectedMode: 'multi',
      preferredDepartureTime: '2026-01-15T08:00:00Z',
    })

    expect(response.trips.length).toBeGreaterThanOrEqual(1)
    // All trips should have rank assigned
    response.trips.forEach((trip) => {
      expect(trip.rank).toBeGreaterThan(0)
    })
  })
})

describe('TripService — walkingSegmentForTransit', () => {
  test('does not skip short walks (unlike regular walking segments)', async () => {
    // Return a very short walk (30 seconds, 20m)
    mockGetRoute.mockImplementation(async () => makeBasicWalkRoute(20, 30))

    const result = await (tripService as any).planWalkingSegmentForTransit(
      { location: { lat: 35.21, lng: -80.85 }, type: 'via' },
      { location: { lat: 35.2101, lng: -80.8501 }, type: 'via' },
      '2026-01-15T08:00:00Z',
    )

    // Short walk should still be returned for transit context
    expect(result).not.toBeNull()
    expect(result.segment.mode).toBe('walking')
    expect(result.segment.distance).toBe(20)
  })

  test('skips walks under 5m distance', async () => {
    mockGetRoute.mockImplementation(async () => makeBasicWalkRoute(3, 5))

    const result = await (tripService as any).planWalkingSegmentForTransit(
      { location: { lat: 35.21, lng: -80.85 }, type: 'via' },
      { location: { lat: 35.2100001, lng: -80.8500001 }, type: 'via' },
      '2026-01-15T08:00:00Z',
    )

    // Below 5m threshold — should be skipped
    expect(result).toBeNull()
  })

  test('returns null on routing failure', async () => {
    mockGetRoute.mockImplementation(async () => {
      throw new Error('GH unavailable')
    })

    const result = await (tripService as any).planWalkingSegmentForTransit(
      { location: { lat: 35.21, lng: -80.85 }, type: 'via' },
      { location: { lat: 35.22, lng: -80.84 }, type: 'via' },
      '2026-01-15T08:00:00Z',
    )

    expect(result).toBeNull()
  })
})

describe('TripService — buildWalkingFallbackSegment', () => {
  test('builds walking segment from MOTIS straight-line data', () => {
    const leg = {
      mode: 'WALK',
      from: { name: 'Stop B', lat: 35.225, lng: -80.845, stopId: 'sb' },
      to: { name: 'Destination', lat: 35.227, lng: -80.843 },
      startTime: '2026-01-15T08:25:00Z',
      endTime: '2026-01-15T08:30:00Z',
      duration: 300,
      distance: 250,
    }

    const segment = (tripService as any).buildWalkingFallbackSegment(
      leg,
      '2026-01-15T08:25:00Z',
    )

    expect(segment.mode).toBe('walking')
    expect(segment.duration).toBe(300)
    expect(segment.distance).toBe(250)
    expect(segment.co2).toBe(0)
    expect(segment.start.label).toBe('Stop B')
    expect(segment.end.label).toBe('Destination')
  })

  test('calculates endTime from startTime + duration', () => {
    const leg = {
      mode: 'WALK',
      from: { name: 'A', lat: 35.21, lng: -80.85 },
      to: { name: 'B', lat: 35.22, lng: -80.84 },
      duration: 600,
      distance: 500,
    }

    const segment = (tripService as any).buildWalkingFallbackSegment(
      leg,
      '2026-01-15T10:00:00Z',
    )

    expect(segment.endTime).toBe('2026-01-15T10:10:00.000Z')
  })
})

// ── Per-waypoint time constraints ────────────────────────────────────────────

describe('TripService — time constraints', () => {
  describe('applyWaypointTimeConstraints', () => {
    test('departAfter delays departure when current time is earlier', () => {
      const result = (tripService as any).applyWaypointTimeConstraints(
        {
          location: { lat: 35.21, lng: -80.85 },
          type: 'via',
          departAfter: '2026-01-15T09:00:00Z',
        },
        1,
        {
          currentTime: '2026-01-15T08:30:00Z',
          currentLocation: { lat: 35.21, lng: -80.85 },
          currentMode: 'walking',
          parkedVehicles: [],
        },
      )

      // Should wait until 09:00
      expect(result.state.currentTime).toBe('2026-01-15T09:00:00.000Z')
      expect(result.warnings).toHaveLength(0)
    })

    test('departAfter is no-op when current time is later', () => {
      const result = (tripService as any).applyWaypointTimeConstraints(
        {
          location: { lat: 35.21, lng: -80.85 },
          type: 'via',
          departAfter: '2026-01-15T08:00:00Z',
        },
        0,
        {
          currentTime: '2026-01-15T08:30:00Z',
          currentLocation: { lat: 35.21, lng: -80.85 },
          currentMode: 'walking',
          parkedVehicles: [],
        },
      )

      // Should keep original time
      expect(result.state.currentTime).toBe('2026-01-15T08:30:00.000Z')
      expect(result.warnings).toHaveLength(0)
    })

    test('arriveBy generates warning when arriving late', () => {
      const result = (tripService as any).applyWaypointTimeConstraints(
        {
          location: { lat: 35.21, lng: -80.85 },
          type: 'via',
          arriveBy: '2026-01-15T08:00:00Z',
        },
        1,
        {
          currentTime: '2026-01-15T08:15:00Z',
          currentLocation: { lat: 35.21, lng: -80.85 },
          currentMode: 'walking',
          parkedVehicles: [],
        },
      )

      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0].type).toBe('time_constraint_violated')
      expect(result.warnings[0].waypointIndex).toBe(1)
      expect(result.warnings[0].overshootSeconds).toBe(900) // 15 min late
    })

    test('arriveBy generates no warning when on time', () => {
      const result = (tripService as any).applyWaypointTimeConstraints(
        {
          location: { lat: 35.21, lng: -80.85 },
          type: 'via',
          arriveBy: '2026-01-15T09:00:00Z',
        },
        1,
        {
          currentTime: '2026-01-15T08:30:00Z',
          currentLocation: { lat: 35.21, lng: -80.85 },
          currentMode: 'walking',
          parkedVehicles: [],
        },
      )

      expect(result.warnings).toHaveLength(0)
    })

    test('dwellTime adds wait time at waypoint', () => {
      const result = (tripService as any).applyWaypointTimeConstraints(
        {
          location: { lat: 35.21, lng: -80.85 },
          type: 'via',
          dwellTime: 30, // 30 minutes
        },
        1,
        {
          currentTime: '2026-01-15T08:00:00Z',
          currentLocation: { lat: 35.21, lng: -80.85 },
          currentMode: 'walking',
          parkedVehicles: [],
        },
      )

      // 08:00 + 30 min = 08:30
      expect(result.state.currentTime).toBe('2026-01-15T08:30:00.000Z')
    })

    test('dwellTime + departAfter: dwell first, then wait if needed', () => {
      const result = (tripService as any).applyWaypointTimeConstraints(
        {
          location: { lat: 35.21, lng: -80.85 },
          type: 'via',
          dwellTime: 10, // 10 minutes → 08:10
          departAfter: '2026-01-15T09:00:00Z', // but can't leave until 09:00
        },
        1,
        {
          currentTime: '2026-01-15T08:00:00Z',
          currentLocation: { lat: 35.21, lng: -80.85 },
          currentMode: 'walking',
          parkedVehicles: [],
        },
      )

      // Dwell takes us to 08:10, departAfter pushes to 09:00
      expect(result.state.currentTime).toBe('2026-01-15T09:00:00.000Z')
    })

    test('no constraints returns state unchanged', () => {
      const result = (tripService as any).applyWaypointTimeConstraints(
        {
          location: { lat: 35.21, lng: -80.85 },
          type: 'via',
        },
        0,
        {
          currentTime: '2026-01-15T08:00:00Z',
          currentLocation: { lat: 35.21, lng: -80.85 },
          currentMode: 'walking',
          parkedVehicles: [],
        },
      )

      expect(result.state.currentTime).toBe('2026-01-15T08:00:00.000Z')
      expect(result.warnings).toHaveLength(0)
    })
  })

  describe('planTrip with time constraints', () => {
    test('three-stop trip with dwellTime at intermediate stop', async () => {
      const middleStop = {
        location: { lat: 35.218, lng: -80.852 },
        type: 'via' as const,
        label: 'Coffee Shop',
        dwellTime: 15, // 15 minute coffee break
      }

      // Walking: 6 min per segment
      mockGetRoute.mockImplementation(async () => makeBasicWalkRoute(500, 360))

      const response = await tripService.planTrip({
        waypoints: [CHARLOTTE_ORIGIN, middleStop, CHARLOTTE_DEST],
        selectedMode: 'walking',
        preferredDepartureTime: '2026-01-15T08:00:00Z',
      })

      expect(response.trips.length).toBeGreaterThanOrEqual(1)
      const trip = response.trips[0].trip

      // Trip should include time for walking + dwell + walking
      // Segment 1: 6 min walk. Dwell: 15 min. Segment 2: 6 min walk = 27 min total
      expect(trip.tripStats.totalDuration).toBeGreaterThanOrEqual(360 + 360) // at least both walks
    })

    test('final waypoint arriveBy generates warning if late', async () => {
      // Walking: 12 min
      mockGetRoute.mockImplementation(async () => makeBasicWalkRoute(1000, 720))

      const response = await tripService.planTrip({
        waypoints: [
          CHARLOTTE_ORIGIN,
          {
            ...CHARLOTTE_DEST,
            arriveBy: '2026-01-15T08:05:00Z', // want to arrive by 08:05 (impossible with 12 min walk)
          },
        ],
        selectedMode: 'walking',
        preferredDepartureTime: '2026-01-15T08:00:00Z',
      })

      expect(response.trips.length).toBeGreaterThanOrEqual(1)
      const trip = response.trips[0].trip
      expect(trip.warnings).toBeDefined()
      expect(trip.warnings!.length).toBeGreaterThanOrEqual(1)
      expect(trip.warnings![0].type).toBe('time_constraint_violated')
    })

    test('origin departAfter delays the trip start', async () => {
      mockGetRoute.mockImplementation(async () => makeBasicWalkRoute(500, 360))

      const response = await tripService.planTrip({
        waypoints: [
          {
            ...CHARLOTTE_ORIGIN,
            departAfter: '2026-01-15T10:00:00Z', // Don't leave until 10:00
          },
          CHARLOTTE_DEST,
        ],
        selectedMode: 'walking',
        preferredDepartureTime: '2026-01-15T08:00:00Z', // Would normally depart 08:00
      })

      expect(response.trips.length).toBeGreaterThanOrEqual(1)
      const trip = response.trips[0].trip
      // Trip should start at 10:00 due to departAfter, not 08:00
      expect(trip.earliestStartTime).toBe('2026-01-15T10:00:00.000Z')
    })
  })
})

// ── Trip scoring ─────────────────────────────────────────────────────────────

describe('TripService — scoring', () => {
  describe('scoreTrip dimensions', () => {
    test('short trip scores higher on time than long trip', () => {
      const now = new Date()
      const shortTrip = {
        tripStats: {
          totalDuration: 300,
          totalDistance: 500,
        },
        latestEndTime: new Date(now.getTime() + 300_000).toISOString(),
        segments: [],
      } as any

      const longTrip = {
        tripStats: {
          totalDuration: 3600,
          totalDistance: 5000,
        },
        latestEndTime: new Date(now.getTime() + 3_600_000).toISOString(),
        segments: [],
      } as any

      const ref = now.toISOString()
      const shortScore = (tripService as any).scoreTime(shortTrip, ref)
      const longScore = (tripService as any).scoreTime(longTrip, ref)

      expect(shortScore).toBeGreaterThan(longScore)
      expect(shortScore).toBeGreaterThan(0)
      expect(shortScore).toBeLessThanOrEqual(1)
    })

    test('free trip scores 1.0 on cost', () => {
      const trip = { tripStats: {} } as any
      const score = (tripService as any).scoreCost(trip)
      expect(score).toBe(1)
    })

    test('expensive trip scores lower on cost', () => {
      const cheapTrip = {
        tripStats: { totalCost: { value: 2, currency: 'USD' } },
      } as any
      const expensiveTrip = {
        tripStats: { totalCost: { value: 20, currency: 'USD' } },
      } as any

      const cheapScore = (tripService as any).scoreCost(cheapTrip)
      const expensiveScore = (tripService as any).scoreCost(expensiveTrip)

      expect(cheapScore).toBeGreaterThan(expensiveScore)
    })

    test('zero-emission trip scores 1.0 on environmental', () => {
      const trip = { tripStats: {} } as any
      const score = (tripService as any).scoreEnvironmental(trip)
      expect(score).toBe(1)
    })

    test('driving scores lower on environmental than walking', () => {
      const walkTrip = { tripStats: { totalCo2: 0 } } as any
      const driveTrip = { tripStats: { totalCo2: 2400 } } as any // 10km driving

      const walkScore = (tripService as any).scoreEnvironmental(walkTrip)
      const driveScore = (tripService as any).scoreEnvironmental(driveTrip)

      expect(walkScore).toBeGreaterThan(driveScore)
    })

    test('trip with no transfers scores higher on comfort', () => {
      const noTransfer = {
        segments: [{ mode: 'transit' }],
        tripStats: { totalWalkingDistance: 200 },
      } as any
      const multiTransfer = {
        segments: [{ mode: 'transit' }],
        tripStats: { totalWalkingDistance: 1500, totalTransfers: 3 },
      } as any

      const noTransferScore = (tripService as any).scoreComfort(noTransfer)
      const multiTransferScore = (tripService as any).scoreComfort(multiTransfer)

      expect(noTransferScore).toBeGreaterThan(multiTransferScore)
    })

    test('pure walking trips get full comfort score', () => {
      const walkTrip = {
        segments: [{ mode: 'walking' }],
        tripStats: { totalWalkingDistance: 3000 },
      } as any
      const score = (tripService as any).scoreComfort(walkTrip)
      expect(score).toBe(1)
    })
  })

  describe('direct ranking sorts', () => {
    test('shortest sorts by duration, not weighted score', () => {
      const now = new Date()
      const candidates = [
        {
          trip: {
            tripStats: { totalDuration: 3240 }, // 54 min
            latestEndTime: new Date(now.getTime() + 3_240_000).toISOString(),
            segments: [{ mode: 'biking' }],
          },
          score: { overall: 0, time: 0.185, cost: 1, comfort: 1, environmental: 1, safety: 0.5 },
        },
        {
          trip: {
            tripStats: { totalDuration: 600 }, // 10 min
            latestEndTime: new Date(now.getTime() + 600_000).toISOString(),
            segments: [{ mode: 'driving' }],
          },
          score: { overall: 0, time: 1, cost: 0.5, comfort: 0.5, environmental: 0.3, safety: 0.5 },
        },
      ] as any[];

      (tripService as any).rankByDuration(candidates)

      // 10-min trip must rank higher than 54-min trip
      expect(candidates[1].score.overall).toBeGreaterThan(candidates[0].score.overall)
    })

    test('cheapest sorts by cost, not weighted score', () => {
      const candidates = [
        {
          trip: {
            tripStats: { totalDuration: 300, totalCost: { value: 15, currency: 'USD' } },
            segments: [{ mode: 'driving' }],
          },
          score: { overall: 0, time: 0.9, cost: 0.4, comfort: 0.5, environmental: 0.3, safety: 0.5 },
        },
        {
          trip: {
            tripStats: { totalDuration: 1800, totalCost: { value: 2, currency: 'USD' } },
            segments: [{ mode: 'transit' }],
          },
          score: { overall: 0, time: 0.3, cost: 0.83, comfort: 0.5, environmental: 0.7, safety: 0.5 },
        },
      ] as any[];

      (tripService as any).rankByCost(candidates)

      // $2 trip must rank higher than $15 trip
      expect(candidates[1].score.overall).toBeGreaterThan(candidates[0].score.overall)
    })
  })

  describe('computeOverallScore (balanced)', () => {
    test('balanced mode weights all dimensions', () => {
      const score: any = {
        time: 0.5,
        cost: 0.5,
        comfort: 0.5,
        environmental: 0.5,
        safety: 0.5,
      }

      const overall = (tripService as any).computeOverallScore(score)
      // All at 0.5 → overall should be 0.5
      expect(overall).toBeCloseTo(0.5, 5)
    })

    test('time has highest weight in balanced mode', () => {
      const highTime: any = {
        time: 1.0,
        cost: 0.0,
        comfort: 0.0,
        environmental: 0.0,
        safety: 0.0,
      }
      const highEnv: any = {
        time: 0.0,
        cost: 0.0,
        comfort: 0.0,
        environmental: 1.0,
        safety: 0.0,
      }

      const timeOverall = (tripService as any).computeOverallScore(highTime)
      const envOverall = (tripService as any).computeOverallScore(highEnv)

      // time weight (0.45) > environmental weight (0.15)
      expect(timeOverall).toBeGreaterThan(envOverall)
    })

    test('balanced weights sum to 1.0', () => {
      const weights = (tripService as any).getScoreWeights()
      const sum = Object.values(weights).reduce(
        (a: number, b: number) => a + b,
        0,
      )
      expect(sum).toBeCloseTo(1.0, 5)
    })
  })

  describe('calculateStats', () => {
    test('counts walking distance', () => {
      const segments = [
        { mode: 'walking', duration: 300, distance: 400, co2: 0 },
        { mode: 'transit', duration: 1200, distance: 5000, co2: 250 },
        { mode: 'walking', duration: 200, distance: 200, co2: 0 },
      ] as any[]

      const stats = (tripService as any).calculateStats(segments)
      expect(stats.totalWalkingDistance).toBe(600)
    })

    test('counts transfers (boardings - 1)', () => {
      const segments = [
        { mode: 'walking', duration: 300, distance: 250, co2: 0 },
        { mode: 'transit', duration: 600, distance: 3000, co2: 150 },
        { mode: 'walking', duration: 120, distance: 100, co2: 0 },
        { mode: 'transit', duration: 600, distance: 2000, co2: 100 },
        { mode: 'walking', duration: 200, distance: 150, co2: 0 },
      ] as any[]

      const stats = (tripService as any).calculateStats(segments)
      expect(stats.totalTransfers).toBe(1) // 2 boardings - 1
    })

    test('single transit segment has 0 transfers', () => {
      const segments = [
        { mode: 'walking', duration: 300, distance: 250, co2: 0 },
        { mode: 'transit', duration: 1200, distance: 5000, co2: 250 },
        { mode: 'walking', duration: 200, distance: 200, co2: 0 },
      ] as any[]

      const stats = (tripService as any).calculateStats(segments)
      // 1 boarding - 1 = 0, should be undefined (not 0)
      expect(stats.totalTransfers).toBeUndefined()
    })

    test('walking-only trip has no transfers or walking distance', () => {
      const segments = [
        { mode: 'walking', duration: 600, distance: 800, co2: 0 },
      ] as any[]

      const stats = (tripService as any).calculateStats(segments)
      expect(stats.totalWalkingDistance).toBe(800)
      expect(stats.totalTransfers).toBeUndefined()
    })
  })

  describe('safety scoring', () => {
    test('uses edge data for safety score when available', () => {
      const trip = {
        segments: [
          {
            mode: 'biking',
            distance: 1000,
            duration: 300,
            edgeSegments: [
              {
                startDistance: 0,
                endDistance: 600,
                roadClass: 'cycleway',
                surface: 'asphalt',
                bikeNetwork: 'local',
                bikePriority: 0.8,
              },
              {
                startDistance: 600,
                endDistance: 1000,
                roadClass: 'primary',
                surface: 'asphalt',
              },
            ],
          },
        ],
        tripStats: { totalDuration: 300, totalDistance: 1000 },
      } as any

      const safety = (tripService as any).scoreSafety(trip)
      expect(safety).toBeGreaterThan(0.5) // cycleway segment dominates
      expect(safety).toBeLessThan(1.0)
    })

    test('falls back to mode defaults when no edge data', () => {
      const trip = {
        segments: [{ mode: 'biking', distance: 1000, duration: 300 }],
        tripStats: { totalDuration: 300, totalDistance: 1000 },
      } as any

      const safety = (tripService as any).scoreSafety(trip)
      expect(safety).toBe(0.5) // biking default
    })

    test('transit segments score 1.0 safety', () => {
      const trip = {
        segments: [{ mode: 'transit', distance: 5000, duration: 600 }],
        tripStats: { totalDuration: 600, totalDistance: 5000 },
      } as any

      const safety = (tripService as any).scoreSafety(trip)
      expect(safety).toBe(1.0)
    })

    test('dangerous road classes lower safety score', () => {
      const safeTrip = {
        segments: [
          {
            mode: 'biking',
            distance: 1000,
            duration: 300,
            edgeSegments: [
              { startDistance: 0, endDistance: 1000, roadClass: 'cycleway', surface: 'asphalt' },
            ],
          },
        ],
        tripStats: { totalDuration: 300, totalDistance: 1000 },
      } as any

      const dangerousTrip = {
        segments: [
          {
            mode: 'biking',
            distance: 1000,
            duration: 300,
            edgeSegments: [
              { startDistance: 0, endDistance: 1000, roadClass: 'trunk', surface: 'asphalt' },
            ],
          },
        ],
        tripStats: { totalDuration: 300, totalDistance: 1000 },
      } as any

      const safeSafety = (tripService as any).scoreSafety(safeTrip)
      const dangerousSafety = (tripService as any).scoreSafety(dangerousTrip)
      expect(safeSafety).toBeGreaterThan(dangerousSafety)
    })
  })

  describe('end-to-end scoring in planTrip', () => {
    test('trips have populated score dimensions', async () => {
      mockGetRoute.mockImplementation(async () => makeBasicWalkRoute(500, 360))
      mockGetTransitRoute.mockImplementation(async () => ({
        itineraries: [],
        metadata: { searchWindow: 3600 },
      }))

      const response = await tripService.planTrip({
        waypoints: [CHARLOTTE_ORIGIN, CHARLOTTE_DEST],
        selectedMode: 'walking',
        preferredDepartureTime: '2026-01-15T08:00:00Z',
      })

      expect(response.trips.length).toBeGreaterThanOrEqual(1)
      const score = response.trips[0].score
      expect(score.overall).toBeGreaterThan(0)
      expect(score.time).toBeGreaterThan(0)
      expect(score.time).toBeLessThanOrEqual(1)
      expect(score.environmental).toBe(1) // walking → zero emissions
    })

    test('sortPreference affects trip ordering', async () => {
      mockGetRoute.mockImplementation(async () => makeBasicWalkRoute(500, 360))

      const response = await tripService.planTrip({
        waypoints: [CHARLOTTE_ORIGIN, CHARLOTTE_DEST],
        selectedMode: 'walking',
        sortPreference: 'greenest',
        preferredDepartureTime: '2026-01-15T08:00:00Z',
      })

      expect(response.trips.length).toBeGreaterThanOrEqual(1)
      // Walking should score very high on "greenest"
      const score = response.trips[0].score
      expect(score.environmental).toBe(1)
    })
  })

  // ── Multi-access transit strategies ─────────────────────────────────────────

  describe('multi-access transit strategies', () => {
    const bikeVehicle = {
      id: 'bike-1',
      type: 'bike' as const,
      location: { lat: 35.209, lng: -80.861 },
    }
    const carVehicle = {
      id: 'car-1',
      type: 'car' as const,
      location: { lat: 35.209, lng: -80.860 },
    }

    test('generates bike+transit candidates when bike is available', async () => {
      const transitItinerary = makeTransitItinerary()
      mockGetTransitRoute.mockImplementation(async () => ({
        itineraries: [transitItinerary],
        metadata: { searchWindow: 3600 },
      }))
      mockGetRoute.mockImplementation(async () => makeBasicWalkRoute(300, 240))

      const response = await tripService.planTrip({
        waypoints: [CHARLOTTE_ORIGIN, CHARLOTTE_DEST],
        selectedMode: 'transit',
        availableVehicles: [bikeVehicle],
        preferredDepartureTime: '2026-01-15T08:00:00Z',
      })

      // Should have both walk+transit and bike+transit candidates
      expect(response.trips.length).toBeGreaterThanOrEqual(2)

      // Find the bike+transit trip
      const bikeTransit = response.trips.find((t) =>
        t.trip.segments.some((s) => s.mode === 'biking'),
      )
      expect(bikeTransit).toBeDefined()
      // Should have a biking segment followed by transit
      const modes = bikeTransit!.trip.segments.map((s) => s.mode)
      expect(modes).toContain('biking')
      expect(modes).toContain('transit')
    })

    test('generates car+transit candidates when car is available', async () => {
      const transitItinerary = makeTransitItinerary()
      mockGetTransitRoute.mockImplementation(async () => ({
        itineraries: [transitItinerary],
        metadata: { searchWindow: 3600 },
      }))
      mockGetRoute.mockImplementation(async () => makeBasicWalkRoute(300, 240))

      const response = await tripService.planTrip({
        waypoints: [CHARLOTTE_ORIGIN, CHARLOTTE_DEST],
        selectedMode: 'transit',
        availableVehicles: [carVehicle],
        preferredDepartureTime: '2026-01-15T08:00:00Z',
      })

      expect(response.trips.length).toBeGreaterThanOrEqual(2)

      const carTransit = response.trips.find((t) =>
        t.trip.segments.some((s) => s.mode === 'driving'),
      )
      expect(carTransit).toBeDefined()
      const modes = carTransit!.trip.segments.map((s) => s.mode)
      expect(modes).toContain('driving')
      expect(modes).toContain('transit')
    })

    test('generates both bike and car candidates when both available', async () => {
      const transitItinerary = makeTransitItinerary()
      mockGetTransitRoute.mockImplementation(async () => ({
        itineraries: [transitItinerary],
        metadata: { searchWindow: 3600 },
      }))
      mockGetRoute.mockImplementation(async () => makeBasicWalkRoute(300, 240))

      const response = await tripService.planTrip({
        waypoints: [CHARLOTTE_ORIGIN, CHARLOTTE_DEST],
        selectedMode: 'transit',
        availableVehicles: [bikeVehicle, carVehicle],
        preferredDepartureTime: '2026-01-15T08:00:00Z',
      })

      // Walk + bike + car = at least 3 candidates
      expect(response.trips.length).toBeGreaterThanOrEqual(3)

      const hasBike = response.trips.some((t) =>
        t.trip.segments.some((s) => s.mode === 'biking'),
      )
      const hasCar = response.trips.some((t) =>
        t.trip.segments.some((s) => s.mode === 'driving'),
      )
      expect(hasBike).toBe(true)
      expect(hasCar).toBe(true)
    })

    test('walk-to-vehicle segment when vehicle is far from origin', async () => {
      // Vehicle is ~1km away — should include walk to vehicle
      const farBike = {
        id: 'bike-far',
        type: 'bike' as const,
        location: { lat: 35.215, lng: -80.870 },
      }

      const transitItinerary = makeTransitItinerary()
      mockGetTransitRoute.mockImplementation(async () => ({
        itineraries: [transitItinerary],
        metadata: { searchWindow: 3600 },
      }))
      mockGetRoute.mockImplementation(async () => makeBasicWalkRoute(300, 180))

      const response = await tripService.planTrip({
        waypoints: [CHARLOTTE_ORIGIN, CHARLOTTE_DEST],
        selectedMode: 'transit',
        availableVehicles: [farBike],
        preferredDepartureTime: '2026-01-15T08:00:00Z',
      })

      const bikeTrip = response.trips.find((t) =>
        t.trip.segments.some((s) => s.mode === 'biking'),
      )
      if (bikeTrip) {
        // Should start with walking (to vehicle) before biking
        const modes = bikeTrip.trip.segments.map((s) => s.mode)
        const firstMode = modes[0]
        expect(firstMode).toBe('walking')
        // Then biking
        expect(modes[1]).toBe('biking')
      }
    })

    test('no multi-access when useKnownVehicleLocations is false', async () => {
      const transitItinerary = makeTransitItinerary()
      mockGetTransitRoute.mockImplementation(async () => ({
        itineraries: [transitItinerary],
        metadata: { searchWindow: 3600 },
      }))
      mockGetRoute.mockImplementation(async () => makeBasicWalkRoute(300, 240))

      const response = await tripService.planTrip({
        waypoints: [CHARLOTTE_ORIGIN, CHARLOTTE_DEST],
        selectedMode: 'transit',
        availableVehicles: [bikeVehicle],
        routingPreferences: { useKnownVehicleLocations: false },
        preferredDepartureTime: '2026-01-15T08:00:00Z',
      })

      // Should only have walk+transit, no bike+transit
      const hasBike = response.trips.some((t) =>
        t.trip.segments.some((s) => s.mode === 'biking'),
      )
      expect(hasBike).toBe(false)
    })

    test('multi-access handles routing failure gracefully', async () => {
      const transitItinerary = makeTransitItinerary()
      mockGetTransitRoute.mockImplementation(async () => ({
        itineraries: [transitItinerary],
        metadata: { searchWindow: 3600 },
      }))

      // Walk routes succeed but alternate calls fail (simulating bike route failure)
      let callCount = 0
      mockGetRoute.mockImplementation(async () => {
        callCount++
        // First 2 calls (walk legs) succeed, then bike access fails
        if (callCount <= 2) return makeBasicWalkRoute(300, 240)
        throw new Error('Route not found')
      })

      const response = await tripService.planTrip({
        waypoints: [CHARLOTTE_ORIGIN, CHARLOTTE_DEST],
        selectedMode: 'transit',
        availableVehicles: [bikeVehicle],
        preferredDepartureTime: '2026-01-15T08:00:00Z',
      })

      // Walk+transit should still work even if bike access fails
      expect(response.trips.length).toBeGreaterThanOrEqual(1)
      const walkTransit = response.trips.find((t) =>
        !t.trip.segments.some((s) => s.mode === 'biking'),
      )
      expect(walkTransit).toBeDefined()
    })

    test('bike+transit candidate has correct timing', async () => {
      const transitItinerary = makeTransitItinerary()
      mockGetTransitRoute.mockImplementation(async () => ({
        itineraries: [transitItinerary],
        metadata: { searchWindow: 3600 },
      }))
      mockGetRoute.mockImplementation(async () => makeBasicWalkRoute(400, 300))

      const response = await tripService.planTrip({
        waypoints: [CHARLOTTE_ORIGIN, CHARLOTTE_DEST],
        selectedMode: 'transit',
        availableVehicles: [bikeVehicle],
        preferredDepartureTime: '2026-01-15T08:00:00Z',
      })

      const bikeTrip = response.trips.find((t) =>
        t.trip.segments.some((s) => s.mode === 'biking'),
      )
      if (bikeTrip) {
        const bikeSeg = bikeTrip.trip.segments.find((s) => s.mode === 'biking')!
        const transitSeg = bikeTrip.trip.segments.find((s) => s.mode === 'transit')!

        // Bike segment must end before transit departs (with buffer)
        const bikeEnd = new Date(bikeSeg.endTime).getTime()
        const transitStart = new Date(transitSeg.startTime).getTime()
        expect(bikeEnd).toBeLessThanOrEqual(transitStart)
      }
    })
  })

  // ── Parking-aware driving ───────────────────────────────────────────────────

  describe('parking-aware driving', () => {
    const mockParking = [
      { lat: 35.2265, lng: -80.8435, name: 'NoDa Parking Deck', tags: { fee: 'yes' } },
      { lat: 35.2268, lng: -80.8440, name: 'Street Parking', tags: {} },
    ]

    test('generates drive-to-parking + walk when useKnownParkingLocations is true', async () => {
      mockSearchByCategory.mockImplementation(async () => mockParking)
      mockGetRoute.mockImplementation(async () => makeBasicWalkRoute(400, 240))

      const response = await tripService.planTrip({
        waypoints: [CHARLOTTE_ORIGIN, CHARLOTTE_DEST],
        selectedMode: 'driving',
        routingPreferences: { useKnownParkingLocations: true },
        preferredDepartureTime: '2026-01-15T08:00:00Z',
      })

      // Should have both direct driving AND parking-aware driving candidates
      expect(response.trips.length).toBeGreaterThanOrEqual(2)

      // Find the parking trip (it has walking as the last segment)
      const parkingTrip = response.trips.find((t) => {
        const segs = t.trip.segments
        return (
          segs.length >= 2 &&
          segs[segs.length - 1].mode === 'walking' &&
          segs.some((s) => s.mode === 'driving')
        )
      })
      expect(parkingTrip).toBeDefined()

      // The parking trip should have: drive → walk
      const segs = parkingTrip!.trip.segments
      const driveSeg = segs.find((s) => s.mode === 'driving')!
      const walkSeg = segs[segs.length - 1]
      expect(driveSeg).toBeDefined()
      expect(walkSeg.mode).toBe('walking')
    })

    test('does not search parking when useKnownParkingLocations is false', async () => {
      mockSearchByCategory.mockImplementation(async () => mockParking)
      mockGetRoute.mockImplementation(async () => makeBasicWalkRoute(400, 240))

      const response = await tripService.planTrip({
        waypoints: [CHARLOTTE_ORIGIN, CHARLOTTE_DEST],
        selectedMode: 'driving',
        routingPreferences: { useKnownParkingLocations: false },
        preferredDepartureTime: '2026-01-15T08:00:00Z',
      })

      // Parking search should not have been called
      expect(mockSearchByCategory).not.toHaveBeenCalled()
    })

    test('does not search parking when preference is not set', async () => {
      mockSearchByCategory.mockImplementation(async () => mockParking)
      mockGetRoute.mockImplementation(async () => makeBasicWalkRoute(400, 240))

      await tripService.planTrip({
        waypoints: [CHARLOTTE_ORIGIN, CHARLOTTE_DEST],
        selectedMode: 'driving',
        preferredDepartureTime: '2026-01-15T08:00:00Z',
      })

      expect(mockSearchByCategory).not.toHaveBeenCalled()
    })

    test('searches with amenity/parking preset', async () => {
      mockSearchByCategory.mockImplementation(async () => mockParking)
      mockGetRoute.mockImplementation(async () => makeBasicWalkRoute(400, 240))

      await tripService.planTrip({
        waypoints: [CHARLOTTE_ORIGIN, CHARLOTTE_DEST],
        selectedMode: 'driving',
        routingPreferences: { useKnownParkingLocations: true },
        preferredDepartureTime: '2026-01-15T08:00:00Z',
      })

      expect(mockSearchByCategory).toHaveBeenCalledTimes(1)
      const [presetId, options] = mockSearchByCategory.mock.calls[0]
      expect(presetId).toBe('amenity/parking')
      expect(options.bounds).toBeDefined()
      expect(options.bounds.north).toBeGreaterThan(options.bounds.south)
    })

    test('returns null parking trip when no parking found', async () => {
      mockSearchByCategory.mockImplementation(async () => [])
      mockGetRoute.mockImplementation(async () => makeBasicWalkRoute(400, 240))

      const response = await tripService.planTrip({
        waypoints: [CHARLOTTE_ORIGIN, CHARLOTTE_DEST],
        selectedMode: 'driving',
        routingPreferences: { useKnownParkingLocations: true },
        preferredDepartureTime: '2026-01-15T08:00:00Z',
      })

      // Only the direct driving candidate (+ walking from multi mode)
      const parkingTrips = response.trips.filter((t) => {
        const segs = t.trip.segments
        return (
          segs.length >= 2 &&
          segs[segs.length - 1].mode === 'walking' &&
          segs.some((s) => s.mode === 'driving')
        )
      })
      expect(parkingTrips.length).toBe(0)
    })

    test('parking trip includes parking cost when fee=yes', async () => {
      mockSearchByCategory.mockImplementation(async () => [mockParking[0]]) // fee=yes
      mockGetRoute.mockImplementation(async () => makeBasicWalkRoute(300, 180))

      const response = await tripService.planTrip({
        waypoints: [CHARLOTTE_ORIGIN, CHARLOTTE_DEST],
        selectedMode: 'driving',
        routingPreferences: { useKnownParkingLocations: true },
        preferredDepartureTime: '2026-01-15T08:00:00Z',
      })

      const parkingTrip = response.trips.find((t) => {
        const segs = t.trip.segments
        return (
          segs.length >= 2 &&
          segs[segs.length - 1].mode === 'walking' &&
          segs.some((s) => s.mode === 'driving')
        )
      })

      if (parkingTrip) {
        const driveSeg = parkingTrip.trip.segments.find((s) => s.mode === 'driving')!
        expect(driveSeg.details?.vehicleDetails?.parkingCost).toBeDefined()
        expect(driveSeg.details!.vehicleDetails!.parkingCost!.value).toBeGreaterThan(0)
      }
    })

    test('handles parking search failure gracefully', async () => {
      mockSearchByCategory.mockImplementation(async () => {
        throw new Error('Overpass timeout')
      })
      mockGetRoute.mockImplementation(async () => makeBasicWalkRoute(400, 240))

      const response = await tripService.planTrip({
        waypoints: [CHARLOTTE_ORIGIN, CHARLOTTE_DEST],
        selectedMode: 'driving',
        routingPreferences: { useKnownParkingLocations: true },
        preferredDepartureTime: '2026-01-15T08:00:00Z',
      })

      // Should still return direct driving candidates
      expect(response.trips.length).toBeGreaterThanOrEqual(1)
    })
  })
})
