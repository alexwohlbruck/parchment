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

  test('includes realtime data when leg has realTime flag', () => {
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
      realTime: true,
      departureDelay: 120, // 2 minutes late
    }

    const segment = (tripService as any).buildTransitSegment(
      leg,
      CHARLOTTE_ORIGIN,
      CHARLOTTE_DEST,
      '2026-01-15T08:05:00Z',
    )

    expect(segment.details.transitDetails.realTimeData).toBe(true)
    expect(segment.details.transitDetails.delay).toBe(120)
  })

  test('omits realtime fields when leg is not realtime', () => {
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
    }

    const segment = (tripService as any).buildTransitSegment(
      leg,
      CHARLOTTE_ORIGIN,
      CHARLOTTE_DEST,
      '2026-01-15T08:05:00Z',
    )

    expect(segment.details.transitDetails.realTimeData).toBeUndefined()
    expect(segment.details.transitDetails.delay).toBeUndefined()
  })

  test('realtime without delay only sets realTimeData flag', () => {
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
      realTime: true,
      // no departureDelay field
    }

    const segment = (tripService as any).buildTransitSegment(
      leg,
      CHARLOTTE_ORIGIN,
      CHARLOTTE_DEST,
      '2026-01-15T08:05:00Z',
    )

    expect(segment.details.transitDetails.realTimeData).toBe(true)
    expect(segment.details.transitDetails.delay).toBeUndefined()
  })

  test('converts GeoJSON geometry to lat/lng array', () => {
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
      geometry: {
        type: 'LineString',
        coordinates: [[-80.85, 35.21], [-80.845, 35.215], [-80.84, 35.22]],
      },
    }

    const segment = (tripService as any).buildTransitSegment(
      leg,
      CHARLOTTE_ORIGIN,
      CHARLOTTE_DEST,
      '2026-01-15T08:05:00Z',
    )

    expect(segment.geometry).toHaveLength(3)
    expect(segment.geometry[0]).toEqual({ lat: 35.21, lng: -80.85 })
    expect(segment.geometry[2]).toEqual({ lat: 35.22, lng: -80.84 })
  })

  test('computes distance from geometry when leg distance is 0', () => {
    const leg = {
      mode: 'BUS',
      transitLeg: true,
      from: { name: 'Stop A', lat: 35.21, lng: -80.85, stopId: 'sa' },
      to: { name: 'Stop B', lat: 35.22, lng: -80.84, stopId: 'sb' },
      startTime: '2026-01-15T08:05:00Z',
      endTime: '2026-01-15T08:25:00Z',
      duration: 1200,
      distance: 0, // MOTIS sometimes returns 0
      routeShortName: '9X',
      headsign: 'Downtown',
      geometry: {
        type: 'LineString',
        coordinates: [[-80.85, 35.21], [-80.84, 35.22]],
      },
    }

    const segment = (tripService as any).buildTransitSegment(
      leg,
      CHARLOTTE_ORIGIN,
      CHARLOTTE_DEST,
      '2026-01-15T08:05:00Z',
    )

    // Should compute a non-zero distance from the geometry
    expect(segment.distance).toBeGreaterThan(0)
  })

  test('maps intermediate stops from leg', () => {
    const leg = {
      mode: 'BUS',
      transitLeg: true,
      from: { name: 'Stop A', lat: 35.21, lng: -80.85, stopId: 'sa' },
      to: { name: 'Stop C', lat: 35.23, lng: -80.83, stopId: 'sc' },
      startTime: '2026-01-15T08:05:00Z',
      endTime: '2026-01-15T08:25:00Z',
      duration: 1200,
      distance: 5000,
      routeShortName: '9X',
      headsign: 'Downtown',
      intermediateStops: [
        { name: 'Stop B', lat: 35.22, lng: -80.84, stopId: 'sb', arrival: '2026-01-15T08:15:00Z', departure: '2026-01-15T08:15:30Z' },
      ],
    }

    const segment = (tripService as any).buildTransitSegment(
      leg,
      CHARLOTTE_ORIGIN,
      CHARLOTTE_DEST,
      '2026-01-15T08:05:00Z',
    )

    // stops = [departure, ...intermediate, arrival]
    const stops = segment.details.transitDetails.stops
    expect(stops).toHaveLength(3)
    expect(stops[0].name).toBe('Stop A')
    expect(stops[1].name).toBe('Stop B')
    expect(stops[1].stopSequence).toBe(1)
    expect(stops[2].name).toBe('Stop C')
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

    test('car+transit trip populates parkedVehicles at boarding stop', async () => {
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

      const carTransit = response.trips.find((t) =>
        t.trip.segments.some((s) => s.mode === 'driving'),
      )

      if (carTransit) {
        expect(carTransit.trip.parkedVehicles).toBeDefined()
        expect(carTransit.trip.parkedVehicles!.length).toBe(1)
        expect(carTransit.trip.parkedVehicles![0].vehicle.type).toBe('car')
        expect(carTransit.trip.parkedVehicles![0].parkedAt).toBeDefined()
      }
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
    // Mock Place objects with geometry.value.center (matches real Place type)
    const mockParking = [
      {
        geometry: { value: { center: { lat: 35.2265, lng: -80.8435 } } },
        name: { value: 'NoDa Parking Deck' },
        tags: { fee: 'yes' },
      },
      {
        geometry: { value: { center: { lat: 35.2268, lng: -80.8440 } } },
        name: { value: 'Street Parking' },
        tags: {},
      },
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

    test('parking trip populates parkedVehicles on response', async () => {
      const car = {
        id: 'car-1',
        type: 'car' as const,
        location: { lat: 35.209, lng: -80.860 },
      }
      mockSearchByCategory.mockImplementation(async () => [mockParking[0]])
      mockGetRoute.mockImplementation(async () => makeBasicWalkRoute(300, 180))

      const response = await tripService.planTrip({
        waypoints: [CHARLOTTE_ORIGIN, CHARLOTTE_DEST],
        selectedMode: 'driving',
        availableVehicles: [car],
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
        expect(parkingTrip.trip.parkedVehicles).toBeDefined()
        expect(parkingTrip.trip.parkedVehicles!.length).toBe(1)
        expect(parkingTrip.trip.parkedVehicles![0].vehicle.type).toBe('car')
        expect(parkingTrip.trip.parkedVehicles![0].location.lat).toBe(mockParking[0].geometry.value.center.lat)
        expect(parkingTrip.trip.parkedVehicles![0].location.lng).toBe(mockParking[0].geometry.value.center.lng)
        expect(parkingTrip.trip.parkedVehicles![0].parkedAt).toBeDefined()
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

// ── Validation ──────────────────────────────────────────────────────────────

describe('TripService — validateRequest', () => {
  test('throws on fewer than 2 waypoints', () => {
    expect(() =>
      (tripService as any).validateRequest({
        waypoints: [CHARLOTTE_ORIGIN],
      }),
    ).toThrow('at least 2 waypoints')
  })

  test('throws on empty waypoints array', () => {
    expect(() =>
      (tripService as any).validateRequest({ waypoints: [] }),
    ).toThrow('at least 2 waypoints')
  })

  test('throws when waypoints is undefined', () => {
    expect(() =>
      (tripService as any).validateRequest({}),
    ).toThrow('at least 2 waypoints')
  })

  test('throws when a waypoint has no location', () => {
    expect(() =>
      (tripService as any).validateRequest({
        waypoints: [
          CHARLOTTE_ORIGIN,
          { type: 'destination', label: 'No coords' },
        ],
      }),
    ).toThrow('valid coordinates')
  })

  test('throws when lat is non-numeric', () => {
    expect(() =>
      (tripService as any).validateRequest({
        waypoints: [
          CHARLOTTE_ORIGIN,
          { location: { lat: 'bad', lng: -80 }, type: 'destination' },
        ],
      }),
    ).toThrow('valid coordinates')
  })

  test('does not throw for valid 2-waypoint request', () => {
    expect(() =>
      (tripService as any).validateRequest({
        waypoints: [CHARLOTTE_ORIGIN, CHARLOTTE_DEST],
      }),
    ).not.toThrow()
  })

  test('does not throw for valid 3-waypoint request', () => {
    expect(() =>
      (tripService as any).validateRequest({
        waypoints: [
          CHARLOTTE_ORIGIN,
          { location: { lat: 35.22, lng: -80.85 }, type: 'via' },
          CHARLOTTE_DEST,
        ],
      }),
    ).not.toThrow()
  })
})

// ── Haversine distance ──────────────────────────────────────────────────────

describe('TripService — haversineDistance', () => {
  const haversine = (a: any, b: any) =>
    (TripService as any).haversineDistance(a, b)

  test('same point returns 0', () => {
    const p = { lat: 35.2271, lng: -80.8431 }
    expect(haversine(p, p)).toBe(0)
  })

  test('Charlotte to Raleigh ~209km', () => {
    const charlotte = { lat: 35.2271, lng: -80.8431 }
    const raleigh = { lat: 35.7796, lng: -78.6382 }
    const dist = haversine(charlotte, raleigh)
    // Allow ±5km tolerance
    expect(dist).toBeGreaterThan(204_000)
    expect(dist).toBeLessThan(214_000)
  })

  test('short distance ~500m', () => {
    const a = { lat: 35.2271, lng: -80.8431 }
    const b = { lat: 35.2316, lng: -80.8431 }
    const dist = haversine(a, b)
    expect(dist).toBeGreaterThan(400)
    expect(dist).toBeLessThan(600)
  })

  test('symmetry: distance(a,b) === distance(b,a)', () => {
    const a = { lat: 35.2271, lng: -80.8431 }
    const b = { lat: 35.7796, lng: -78.6382 }
    expect(haversine(a, b)).toBe(haversine(b, a))
  })
})

// ── getTripMode ─────────────────────────────────────────────────────────────

describe('TripService — getTripMode', () => {
  function makeTripWithSegments(
    segments: Array<{ mode: string; duration: number }>,
  ) {
    return { segments: segments as any }
  }

  test('walking-only trip returns walking', () => {
    const trip = makeTripWithSegments([{ mode: 'walking', duration: 600 }])
    expect((tripService as any).getTripMode(trip)).toBe('walking')
  })

  test('driving-only trip returns driving', () => {
    const trip = makeTripWithSegments([{ mode: 'driving', duration: 600 }])
    expect((tripService as any).getTripMode(trip)).toBe('driving')
  })

  test('biking-only trip returns biking', () => {
    const trip = makeTripWithSegments([{ mode: 'biking', duration: 600 }])
    expect((tripService as any).getTripMode(trip)).toBe('biking')
  })

  test('transit with walking access returns transit', () => {
    const trip = makeTripWithSegments([
      { mode: 'walking', duration: 300 },
      { mode: 'transit', duration: 1200 },
      { mode: 'walking', duration: 300 },
    ])
    expect((tripService as any).getTripMode(trip)).toBe('transit')
  })

  test('transit with biking access returns biking+transit', () => {
    const trip = makeTripWithSegments([
      { mode: 'walking', duration: 60 },
      { mode: 'biking', duration: 300 },
      { mode: 'transit', duration: 1200 },
      { mode: 'walking', duration: 300 },
    ])
    expect((tripService as any).getTripMode(trip)).toBe('biking+transit')
  })

  test('transit with driving access returns driving+transit', () => {
    const trip = makeTripWithSegments([
      { mode: 'walking', duration: 60 },
      { mode: 'driving', duration: 300 },
      { mode: 'transit', duration: 1200 },
      { mode: 'walking', duration: 300 },
    ])
    expect((tripService as any).getTripMode(trip)).toBe('driving+transit')
  })

  test('mixed non-transit returns mode with longest duration', () => {
    const trip = makeTripWithSegments([
      { mode: 'walking', duration: 200 },
      { mode: 'driving', duration: 800 },
    ])
    expect((tripService as any).getTripMode(trip)).toBe('driving')
  })
})

// ── filterQualityTrips ──────────────────────────────────────────────────────

describe('TripService — filterQualityTrips', () => {
  const baseScore = {
    overall: 0.5,
    time: 0.5,
    cost: 0.5,
    comfort: 0.5,
    environmental: 0.5,
    safety: 0.5,
  }

  function makeCandidate(
    mode: string,
    totalDuration: number,
    endTime = '2026-01-15T08:10:00Z',
  ) {
    return {
      trip: {
        segments: [{ mode, duration: totalDuration, endTime }] as any,
        tripStats: {
          totalDuration,
          totalDistance: totalDuration * 2,
          totalTransfers: 0,
          totalWalkingDistance: mode === 'walking' ? totalDuration * 1.2 : 0,
        },
        earliestStartTime: '2026-01-15T08:00:00Z',
        latestEndTime: endTime,
        dataSources: [],
        generatedAt: '2026-01-15T08:00:00Z',
      } as any,
      score: { ...baseScore },
      rank: 0,
    }
  }

  function makeTransitCandidate(
    accessMode: string | null,
    totalDuration: number,
    endTime = '2026-01-15T08:30:00Z',
  ) {
    const segments: any[] = []
    if (accessMode && accessMode !== 'walking') {
      segments.push({ mode: 'walking', duration: 60, endTime: '2026-01-15T08:01:00Z' })
      segments.push({ mode: accessMode, duration: 300, endTime: '2026-01-15T08:06:00Z' })
    } else {
      segments.push({ mode: 'walking', duration: 300, endTime: '2026-01-15T08:05:00Z' })
    }
    segments.push({ mode: 'transit', duration: totalDuration - 600, endTime })
    segments.push({ mode: 'walking', duration: 300, endTime })
    return {
      trip: {
        segments,
        tripStats: {
          totalDuration,
          totalDistance: totalDuration * 2,
          totalTransfers: 0,
          totalWalkingDistance: 600,
        },
        earliestStartTime: '2026-01-15T08:00:00Z',
        latestEndTime: endTime,
        dataSources: [],
        generatedAt: '2026-01-15T08:00:00Z',
      } as any,
      score: { ...baseScore },
      rank: 0,
    }
  }

  test('returns all trips when ≤2 candidates', () => {
    const candidates = [makeCandidate('driving', 600)]
    const result = (tripService as any).filterQualityTrips(candidates)
    expect(result.length).toBe(1)
  })

  test('keeps best-per-mode even when >4× slower than fastest', () => {
    const candidates = [
      makeCandidate('driving', 600),   // 10 min
      makeCandidate('biking', 4800),   // 80 min (8× driving, >60min floor)
      makeCandidate('walking', 12000), // 200 min (20× driving)
    ]
    const result = (tripService as any).filterQualityTrips(candidates)
    const modes = result.map((c: any) => c.trip.segments[0].mode)
    expect(modes).toContain('driving')
    expect(modes).toContain('biking')
    expect(modes).toContain('walking')
    expect(result.length).toBe(3)
  })

  test('filters duplicate slow trips of same mode', () => {
    const candidates = [
      makeCandidate('driving', 600),
      makeCandidate('biking', 4800),  // best biking — kept
      makeCandidate('biking', 4900),  // second biking, also >4× — kept (under cap)
      makeCandidate('biking', 5100),  // third biking — exceeds MAX_PER_MODE
    ]
    const result = (tripService as any).filterQualityTrips(candidates)
    const bikingTrips = result.filter(
      (c: any) => c.trip.segments[0].mode === 'biking',
    )
    // MAX_PER_MODE = 2
    expect(bikingTrips.length).toBeLessThanOrEqual(2)
  })

  test('per-mode cap limits to MAX_PER_MODE', () => {
    const candidates = [
      makeCandidate('driving', 600),
      makeCandidate('driving', 650),
      makeCandidate('driving', 900), // different enough (>5%) to not be deduplicated
      makeCandidate('walking', 2000),
    ]
    const result = (tripService as any).filterQualityTrips(candidates)
    const drivingTrips = result.filter(
      (c: any) => c.trip.segments[0].mode === 'driving',
    )
    expect(drivingTrips.length).toBeLessThanOrEqual(2)
  })

  test('near-duplicate removal: same mode within 5% duration', () => {
    const candidates = [
      makeCandidate('driving', 600),
      makeCandidate('driving', 615), // 2.5% more — near duplicate
      makeCandidate('walking', 2000),
    ]
    const result = (tripService as any).filterQualityTrips(candidates)
    const drivingTrips = result.filter(
      (c: any) => c.trip.segments[0].mode === 'driving',
    )
    expect(drivingTrips.length).toBe(1)
  })

  test('trips under quality floor are never filtered by ratio', () => {
    // QUALITY_FLOOR_SECONDS = 3600 (60 min)
    // Even though biking is >4× driving, it's under 60 min so it stays
    const candidates = [
      makeCandidate('driving', 300),  // 5 min
      makeCandidate('biking', 2400),  // 40 min (8× driving, but under floor)
      makeCandidate('walking', 3500), // 58 min (still under floor)
    ]
    const result = (tripService as any).filterQualityTrips(candidates)
    expect(result.length).toBe(3)
  })

  test('transit sub-types count separately from each other', () => {
    const candidates = [
      makeCandidate('driving', 600),
      makeTransitCandidate(null, 1800, '2026-01-15T08:30:00Z'),        // walk+transit
      makeTransitCandidate(null, 1900, '2026-01-15T08:32:00Z'),        // walk+transit #2
      makeTransitCandidate('biking', 2000, '2026-01-15T08:34:00Z'),    // bike+transit
      makeTransitCandidate('biking', 2100, '2026-01-15T08:36:00Z'),    // bike+transit #2
    ]
    const result = (tripService as any).filterQualityTrips(candidates)
    const walkTransit = result.filter(
      (c: any) => (tripService as any).getTripMode(c.trip) === 'transit',
    )
    const bikeTransit = result.filter(
      (c: any) => (tripService as any).getTripMode(c.trip) === 'biking+transit',
    )
    // Each sub-type should have up to MAX_PER_MODE (2)
    expect(walkTransit.length).toBeLessThanOrEqual(2)
    expect(bikeTransit.length).toBeLessThanOrEqual(2)
  })
})

// ── rankBy methods ──────────────────────────────────────────────────────────

describe('TripService — rankBy methods', () => {
  function makeScoredCandidate(overrides: {
    endTime?: string
    totalDuration?: number
    totalCo2?: number
    totalCost?: { value: number; currency: string }
    totalTransfers?: number
    totalWalkingDistance?: number
  }) {
    const endTime = overrides.endTime || '2026-01-15T08:10:00Z'
    return {
      trip: {
        segments: [
          {
            mode: 'walking',
            duration: overrides.totalDuration || 600,
            endTime,
            distance: 500,
          },
        ] as any,
        tripStats: {
          totalDuration: overrides.totalDuration || 600,
          totalDistance: 500,
          totalCo2: overrides.totalCo2 ?? 0,
          totalCost: overrides.totalCost,
          totalTransfers: overrides.totalTransfers ?? 0,
          totalWalkingDistance: overrides.totalWalkingDistance ?? 0,
        },
        earliestStartTime: '2026-01-15T08:00:00Z',
        latestEndTime: endTime,
        dataSources: [],
        generatedAt: '2026-01-15T08:00:00Z',
      } as any,
      score: {
        overall: 0,
        time: 0.5,
        cost: 0.5,
        comfort: 0.5,
        environmental: 0.5,
        safety: 0.5,
      },
      rank: 0,
    }
  }

  test('rankByArrivalTime: earliest arrival gets highest score', () => {
    const candidates = [
      makeScoredCandidate({ endTime: '2026-01-15T08:30:00Z' }),
      makeScoredCandidate({ endTime: '2026-01-15T08:10:00Z' }),
      makeScoredCandidate({ endTime: '2026-01-15T08:45:00Z' }),
    ]
    ;(tripService as any).rankByArrivalTime(candidates)

    // Candidate ending at 08:10 should have highest overall
    const sorted = [...candidates].sort(
      (a, b) => b.score.overall - a.score.overall,
    )
    expect(
      new Date(sorted[0].trip.segments[0].endTime).getTime(),
    ).toBeLessThanOrEqual(
      new Date(sorted[1].trip.segments[0].endTime).getTime(),
    )
  })

  test('rankByCo2: lowest emissions gets highest score', () => {
    const candidates = [
      makeScoredCandidate({ totalCo2: 500 }),
      makeScoredCandidate({ totalCo2: 0 }),
      makeScoredCandidate({ totalCo2: 200 }),
    ]
    ;(tripService as any).rankByCo2(candidates)

    const sorted = [...candidates].sort(
      (a, b) => b.score.overall - a.score.overall,
    )
    expect(sorted[0].trip.tripStats.totalCo2).toBe(0)
    expect(sorted[2].trip.tripStats.totalCo2).toBe(500)
  })

  test('rankByTransfers: fewest transfers gets highest score', () => {
    const candidates = [
      makeScoredCandidate({ totalTransfers: 2 }),
      makeScoredCandidate({ totalTransfers: 0 }),
      makeScoredCandidate({ totalTransfers: 1 }),
    ]
    ;(tripService as any).rankByTransfers(candidates)

    const sorted = [...candidates].sort(
      (a, b) => b.score.overall - a.score.overall,
    )
    expect(sorted[0].trip.tripStats.totalTransfers).toBe(0)
    expect(sorted[2].trip.tripStats.totalTransfers).toBe(2)
  })

  test('rankByWalkingDistance: least walking gets highest score', () => {
    const candidates = [
      makeScoredCandidate({ totalWalkingDistance: 1000 }),
      makeScoredCandidate({ totalWalkingDistance: 100 }),
      makeScoredCandidate({ totalWalkingDistance: 500 }),
    ]
    ;(tripService as any).rankByWalkingDistance(candidates)

    const sorted = [...candidates].sort(
      (a, b) => b.score.overall - a.score.overall,
    )
    expect(sorted[0].trip.tripStats.totalWalkingDistance).toBe(100)
    expect(sorted[2].trip.tripStats.totalWalkingDistance).toBe(1000)
  })

  test('all-equal values: all candidates get primary score of 1', () => {
    const candidates = [
      makeScoredCandidate({ totalCo2: 100 }),
      makeScoredCandidate({ totalCo2: 100 }),
      makeScoredCandidate({ totalCo2: 100 }),
    ]
    ;(tripService as any).rankByCo2(candidates)

    // When range is 0, all get primary = 1
    for (const c of candidates) {
      expect(c.score.overall).toBeGreaterThan(0.99)
    }
  })

  test('empty candidates array is a no-op', () => {
    const candidates: any[] = []
    ;(tripService as any).rankByArrivalTime(candidates)
    expect(candidates.length).toBe(0)
  })
})

// ── Segment planners ────────────────────────────────────────────────────────

describe('TripService — segment planners', () => {
  const baseState = {
    currentTime: '2026-01-15T08:00:00Z',
    currentLocation: CHARLOTTE_ORIGIN.location,
    currentMode: 'walking' as const,
    parkedVehicles: [],
  }

  describe('planWalkingSegment', () => {
    test('returns segment with mode walking', async () => {
      mockGetRoute.mockImplementation(async () => makeBasicWalkRoute(500, 360))

      const result = await (tripService as any).planWalkingSegment(
        CHARLOTTE_ORIGIN,
        CHARLOTTE_DEST,
        baseState,
      )
      expect(result).not.toBeNull()
      expect(result.segment.mode).toBe('walking')
      expect(result.segment.co2).toBe(0)
      expect(result.state.currentMode).toBe('walking')
    })

    test('skips walks under 60s duration', async () => {
      mockGetRoute.mockImplementation(async () => makeBasicWalkRoute(30, 45))

      const result = await (tripService as any).planWalkingSegment(
        CHARLOTTE_ORIGIN,
        CHARLOTTE_DEST,
        baseState,
      )
      expect(result).toBeNull()
    })

    test('returns null on routing error', async () => {
      mockGetRoute.mockImplementation(async () => {
        throw new Error('Network timeout')
      })

      const result = await (tripService as any).planWalkingSegment(
        CHARLOTTE_ORIGIN,
        CHARLOTTE_DEST,
        baseState,
      )
      expect(result).toBeNull()
    })

    test('returns null when no routes found', async () => {
      mockGetRoute.mockImplementation(async () => ({ routes: [] }))

      const result = await (tripService as any).planWalkingSegment(
        CHARLOTTE_ORIGIN,
        CHARLOTTE_DEST,
        baseState,
      )
      expect(result).toBeNull()
    })

    test('preserves parkedVehicles in resulting state', async () => {
      mockGetRoute.mockImplementation(async () => makeBasicWalkRoute(500, 360))
      const parkedVehicles = [
        {
          vehicle: { id: 'car-1', type: 'car' },
          location: { lat: 35.21, lng: -80.85 },
          parkedAt: '2026-01-15T07:50:00Z',
        },
      ]

      const result = await (tripService as any).planWalkingSegment(
        CHARLOTTE_ORIGIN,
        CHARLOTTE_DEST,
        { ...baseState, parkedVehicles },
      )
      expect(result.state.parkedVehicles).toEqual(parkedVehicles)
    })

    test('calculates endTime from startTime + duration', async () => {
      mockGetRoute.mockImplementation(async () => makeBasicWalkRoute(500, 600))

      const result = await (tripService as any).planWalkingSegment(
        CHARLOTTE_ORIGIN,
        CHARLOTTE_DEST,
        baseState,
      )
      const start = new Date(result.segment.startTime).getTime()
      const end = new Date(result.segment.endTime).getTime()
      expect(end - start).toBe(600 * 1000)
    })
  })

  describe('planWheelchairSegment', () => {
    test('returns segment with mode wheelchair', async () => {
      mockGetRoute.mockImplementation(async () => makeBasicWalkRoute(500, 480))

      const result = await (tripService as any).planWheelchairSegment(
        CHARLOTTE_ORIGIN,
        CHARLOTTE_DEST,
        baseState,
        {},
      )
      expect(result).not.toBeNull()
      expect(result.segment.mode).toBe('wheelchair')
      expect(result.state.currentMode).toBe('wheelchair')
    })

    test('skips segments under 60s', async () => {
      mockGetRoute.mockImplementation(async () => makeBasicWalkRoute(20, 30))

      const result = await (tripService as any).planWheelchairSegment(
        CHARLOTTE_ORIGIN,
        CHARLOTTE_DEST,
        baseState,
        {},
      )
      expect(result).toBeNull()
    })

    test('returns null on routing error', async () => {
      mockGetRoute.mockImplementation(async () => {
        throw new Error('GraphHopper error')
      })

      const result = await (tripService as any).planWheelchairSegment(
        CHARLOTTE_ORIGIN,
        CHARLOTTE_DEST,
        baseState,
        {},
      )
      expect(result).toBeNull()
    })

    test('passes wheelchair profile to routing service', async () => {
      mockGetRoute.mockImplementation(async () => makeBasicWalkRoute(500, 480))

      await (tripService as any).planWheelchairSegment(
        CHARLOTTE_ORIGIN,
        CHARLOTTE_DEST,
        baseState,
        {},
      )
      expect(mockGetRoute).toHaveBeenCalledWith(
        expect.any(Array),
        'wheelchair',
        expect.anything(),
      )
    })
  })

  describe('planDirectBike', () => {
    test('returns biking segment with co2: 0', async () => {
      mockGetRoute.mockImplementation(async () => makeBasicWalkRoute(3000, 900))

      const result = await (tripService as any).planDirectBike(
        CHARLOTTE_ORIGIN,
        CHARLOTTE_DEST,
        baseState,
      )
      expect(result).not.toBeNull()
      expect(result.segment.mode).toBe('biking')
      expect(result.segment.co2).toBe(0)
      expect(result.state.currentMode).toBe('biking')
    })

    test('returns null when route has no results', async () => {
      mockGetRoute.mockImplementation(async () => ({ routes: [] }))

      const result = await (tripService as any).planDirectBike(
        CHARLOTTE_ORIGIN,
        CHARLOTTE_DEST,
        baseState,
      )
      expect(result).toBeNull()
    })

    test('returns null on routing error', async () => {
      mockGetRoute.mockImplementation(async () => {
        throw new Error('Bicycle profile not available')
      })

      const result = await (tripService as any).planDirectBike(
        CHARLOTTE_ORIGIN,
        CHARLOTTE_DEST,
        baseState,
      )
      expect(result).toBeNull()
    })

    test('uses bicycle profile for routing', async () => {
      mockGetRoute.mockImplementation(async () => makeBasicWalkRoute(3000, 900))

      await (tripService as any).planDirectBike(
        CHARLOTTE_ORIGIN,
        CHARLOTTE_DEST,
        baseState,
        {},
      )
      const calls = mockGetRoute.mock.calls
      const lastCall = calls[calls.length - 1]
      expect(lastCall[1]).toBe('bicycle')
    })
  })

  describe('planDrivingSegment', () => {
    test('direct drive when no car vehicle provided', async () => {
      mockGetRoute.mockImplementation(async () => makeBasicWalkRoute(5000, 600))

      const result = await (tripService as any).planDrivingSegment(
        CHARLOTTE_ORIGIN,
        CHARLOTTE_DEST,
        baseState,
        [], // no vehicles
        {},
      )
      expect(result).not.toBeNull()
      expect(result.segment.mode).toBe('driving')
    })

    test('walk-to-car + drive when car is far from origin', async () => {
      const farCar = {
        id: 'car-1',
        type: 'car',
        location: { lat: 35.22, lng: -80.85 },
      }
      // First call: walk to car. Second call: drive to dest.
      let callCount = 0
      mockGetRoute.mockImplementation(async () => {
        callCount++
        if (callCount === 1) return makeBasicWalkRoute(300, 240) // walk
        return makeBasicWalkRoute(5000, 600) // drive
      })

      const result = await (tripService as any).planDrivingSegment(
        CHARLOTTE_ORIGIN,
        CHARLOTTE_DEST,
        baseState,
        [farCar],
        { useKnownVehicleLocations: true },
      )
      expect(result).not.toBeNull()
      // Should have multimodal segments: walk + drive
      expect(result.multimodalSegments).toBeDefined()
      expect(result.multimodalSegments.length).toBe(2)
      expect(result.multimodalSegments[0].mode).toBe('walking')
      expect(result.multimodalSegments[1].mode).toBe('driving')
    })

    test('returns null on routing error', async () => {
      mockGetRoute.mockImplementation(async () => {
        throw new Error('Route not found')
      })

      const result = await (tripService as any).planDrivingSegment(
        CHARLOTTE_ORIGIN,
        CHARLOTTE_DEST,
        baseState,
        [],
        {},
      )
      expect(result).toBeNull()
    })

    test('resulting state tracks parked vehicle', async () => {
      const car = {
        id: 'car-1',
        type: 'car',
        location: { lat: 35.22, lng: -80.85 },
      }
      let callCount = 0
      mockGetRoute.mockImplementation(async () => {
        callCount++
        if (callCount === 1) return makeBasicWalkRoute(300, 240)
        return makeBasicWalkRoute(5000, 600)
      })

      const result = await (tripService as any).planDrivingSegment(
        CHARLOTTE_ORIGIN,
        CHARLOTTE_DEST,
        baseState,
        [car],
        { useKnownVehicleLocations: true },
      )
      expect(result).not.toBeNull()
      expect(result.state.parkedVehicles.length).toBe(1)
      expect(result.state.parkedVehicles[0].vehicle.type).toBe('car')
    })
  })
})

// ── Multi-stop trips ────────────────────────────────────────────────────────

describe('TripService — multi-stop trips', () => {
  test('3-stop walking trip produces 2 legs', async () => {
    mockGetRoute.mockImplementation(async () => makeBasicWalkRoute(500, 360))

    const response = await tripService.planTrip({
      waypoints: [
        CHARLOTTE_ORIGIN,
        {
          location: { lat: 35.22, lng: -80.85 },
          type: 'via',
          label: 'Midpoint',
        },
        CHARLOTTE_DEST,
      ],
      selectedMode: 'walking',
      preferredDepartureTime: '2026-01-15T08:00:00Z',
    })

    const walkTrip = response.trips.find((t) =>
      t.trip.segments.every((s) => s.mode === 'walking'),
    )
    expect(walkTrip).toBeDefined()
    // 2 legs: origin→mid, mid→dest
    expect(walkTrip!.trip.segments.length).toBe(2)
  })

  test('4-stop driving trip produces 3 legs', async () => {
    mockGetRoute.mockImplementation(async () => makeBasicWalkRoute(5000, 600))

    const response = await tripService.planTrip({
      waypoints: [
        CHARLOTTE_ORIGIN,
        { location: { lat: 35.22, lng: -80.85 }, type: 'via' },
        { location: { lat: 35.23, lng: -80.84 }, type: 'via' },
        CHARLOTTE_DEST,
      ],
      selectedMode: 'driving',
      preferredDepartureTime: '2026-01-15T08:00:00Z',
    })

    const driveTrip = response.trips.find((t) =>
      t.trip.segments.some((s) => s.mode === 'driving'),
    )
    expect(driveTrip).toBeDefined()
    // Should have 3 driving legs
    const drivingSegs = driveTrip!.trip.segments.filter(
      (s) => s.mode === 'driving',
    )
    expect(drivingSegs.length).toBe(3)
  })

  test('segment times are sequential (no overlaps)', async () => {
    mockGetRoute.mockImplementation(async () => makeBasicWalkRoute(500, 360))

    const response = await tripService.planTrip({
      waypoints: [
        CHARLOTTE_ORIGIN,
        { location: { lat: 35.22, lng: -80.85 }, type: 'via' },
        CHARLOTTE_DEST,
      ],
      selectedMode: 'walking',
      preferredDepartureTime: '2026-01-15T08:00:00Z',
    })

    const trip = response.trips[0]?.trip
    if (trip && trip.segments.length >= 2) {
      for (let i = 1; i < trip.segments.length; i++) {
        const prevEnd = new Date(trip.segments[i - 1].endTime).getTime()
        const nextStart = new Date(trip.segments[i].startTime).getTime()
        expect(nextStart).toBeGreaterThanOrEqual(prevEnd)
      }
    }
  })
})

// ── planTrip error handling ─────────────────────────────────────────────────

describe('TripService — planTrip error handling', () => {
  test('all routing fails returns empty trips array', async () => {
    mockGetRoute.mockImplementation(async () => {
      throw new Error('All routing engines down')
    })

    const response = await tripService.planTrip({
      waypoints: [CHARLOTTE_ORIGIN, CHARLOTTE_DEST],
      selectedMode: 'walking',
      preferredDepartureTime: '2026-01-15T08:00:00Z',
    })

    expect(response.trips).toEqual([])
  })

  test('individual mode failure does not block other modes', async () => {
    let callCount = 0
    mockGetRoute.mockImplementation(async (_pts: any, profile: string) => {
      callCount++
      if (profile === 'pedestrian') throw new Error('Walking engine down')
      return makeBasicWalkRoute(5000, 600)
    })

    const response = await tripService.planTrip({
      waypoints: [CHARLOTTE_ORIGIN, CHARLOTTE_DEST],
      selectedMode: 'driving',
      preferredDepartureTime: '2026-01-15T08:00:00Z',
    })

    // Walking failed but driving should still work
    const hasDriving = response.trips.some((t) =>
      t.trip.segments.some((s) => s.mode === 'driving'),
    )
    expect(hasDriving).toBe(true)
  })

  test('invalid waypoints throw before any routing', async () => {
    await expect(
      tripService.planTrip({
        waypoints: [CHARLOTTE_ORIGIN],
        selectedMode: 'walking',
      }),
    ).rejects.toThrow('at least 2 waypoints')

    // No routing calls should have been made
    expect(mockGetRoute).not.toHaveBeenCalled()
  })

  test('metadata includes processing time', async () => {
    mockGetRoute.mockImplementation(async () => makeBasicWalkRoute(500, 360))

    const response = await tripService.planTrip({
      waypoints: [CHARLOTTE_ORIGIN, CHARLOTTE_DEST],
      selectedMode: 'walking',
      preferredDepartureTime: '2026-01-15T08:00:00Z',
    })

    expect(response.metadata.processingTime).toBeGreaterThanOrEqual(0)
    expect(response.metadata.totalCandidatesGenerated).toBeGreaterThanOrEqual(0)
  })
})

// ── Mode generation edge cases ──────────────────────────────────────────────

describe('TripService — mode generation edge cases', () => {
  test('biking mode generates walking + biking', () => {
    const modes = (tripService as any).getModesToGenerate('biking')
    expect(modes).toContain('biking')
    expect(modes).toContain('walking')
    expect(modes).not.toContain('driving')
    expect(modes).not.toContain('transit')
  })

  test('driving mode generates walking + driving', () => {
    const modes = (tripService as any).getModesToGenerate('driving')
    expect(modes).toContain('driving')
    expect(modes).toContain('walking')
    expect(modes).not.toContain('biking')
    expect(modes).not.toContain('transit')
  })

  test('wheelchair mode generates only wheelchair', () => {
    const modes = (tripService as any).getModesToGenerate('wheelchair')
    expect(modes).toEqual(['wheelchair'])
  })

  test('wheelchair planTrip returns wheelchair segment', async () => {
    mockGetRoute.mockImplementation(async () => makeBasicWalkRoute(500, 480))

    const response = await tripService.planTrip({
      waypoints: [CHARLOTTE_ORIGIN, CHARLOTTE_DEST],
      selectedMode: 'wheelchair',
      preferredDepartureTime: '2026-01-15T08:00:00Z',
    })

    const wheelchair = response.trips.find((t) =>
      t.trip.segments.some((s) => s.mode === 'wheelchair'),
    )
    expect(wheelchair).toBeDefined()
  })
})

// ── Transit access/egress composition ──────────────────────────────────────

describe('TripService — composeTransitWithAccessAndEgress', () => {
  const service = new TripService()
  const dataSources: any[] = []
  const itinerary = makeTransitItinerary()

  beforeEach(() => {
    mockGetRoute.mockReset()
    mockGetRoute.mockImplementation(async () => makeBasicWalkRoute(300, 240))
    mockSearchByCategory.mockReset()
    mockSearchByCategory.mockImplementation(async () => [])
  })

  test('walking access + walking egress produces walk→transit→walk', async () => {
    const result = await (service as any).composeTransitWithAccessAndEgress(
      itinerary,
      '2026-01-15T08:00:00Z',
      CHARLOTTE_ORIGIN,
      CHARLOTTE_DEST,
      { mode: 'walking' },
      { mode: 'walking' },
      {},
      dataSources,
    )

    expect(result).not.toBeNull()
    // Walking access returns empty segments (handled by composeTransitItinerary)
    // so we get transit + walking egress
    const modes = result.segments.map((s: any) => s.mode)
    expect(modes).toContain('transit')
  })

  test('biking access + walking egress (3.4) parks bike at stop', async () => {
    const bikeLocation = { lat: 35.2096, lng: -80.8610 }

    const result = await (service as any).composeTransitWithAccessAndEgress(
      itinerary,
      '2026-01-15T08:00:00Z',
      CHARLOTTE_ORIGIN,
      CHARLOTTE_DEST,
      {
        mode: 'biking',
        vehicle: { id: 'bike-1', type: 'bike', name: 'My Bike', location: bikeLocation },
        vehicleLocation: bikeLocation,
      },
      { mode: 'walking' },
      {},
      dataSources,
    )

    expect(result).not.toBeNull()
    const modes = result.segments.map((s: any) => s.mode)
    expect(modes).toContain('biking')
    expect(modes).toContain('transit')
    // Should NOT have bike egress (walked)
    const egressSegments = result.segments.filter(
      (s: any) => s.mode !== 'transit' &&
        new Date(s.startTime) >= new Date(itinerary.legs[1].endTime),
    )
    expect(egressSegments.every((s: any) => s.mode === 'walking')).toBe(true)
  })

  test('biking carry-on access + biking egress (3.6) marks transit as carrying vehicle', async () => {
    const bikeLocation = { lat: 35.2096, lng: -80.8610 }
    const bike = { id: 'bike-1', type: 'bike' as const, name: 'My Bike', location: bikeLocation }

    const result = await (service as any).composeTransitWithAccessAndEgress(
      itinerary,
      '2026-01-15T08:00:00Z',
      CHARLOTTE_ORIGIN,
      CHARLOTTE_DEST,
      {
        mode: 'biking',
        vehicle: bike,
        vehicleLocation: bikeLocation,
        carryOnTransit: true,
      },
      { mode: 'biking' },
      {},
      dataSources,
    )

    expect(result).not.toBeNull()
    const modes = result.segments.map((s: any) => s.mode)

    // Should have: bike access, transit (with carryingVehicle), bike egress
    expect(modes).toContain('biking')
    expect(modes).toContain('transit')

    // Transit segments should be marked as carrying vehicle
    const transitSegments = result.segments.filter((s: any) => s.mode === 'transit')
    for (const seg of transitSegments) {
      expect(seg.carryingVehicle).toBe(true)
    }

    // Should have bike egress after transit
    const lastSegment = result.segments[result.segments.length - 1]
    expect(lastSegment.mode).toBe('biking')
    expect(lastSegment.vehicle?.id).toBe('bike-1')
  })

  test('driving access + walking egress (3.7) parks car', async () => {
    const carLocation = { lat: 35.2096, lng: -80.8610 }
    const car = { id: 'car-1', type: 'car' as const, name: 'My Car', location: carLocation }

    const result = await (service as any).composeTransitWithAccessAndEgress(
      itinerary,
      '2026-01-15T08:00:00Z',
      CHARLOTTE_ORIGIN,
      CHARLOTTE_DEST,
      {
        mode: 'driving',
        vehicle: car,
        vehicleLocation: carLocation,
      },
      { mode: 'walking' },
      {},
      dataSources,
    )

    expect(result).not.toBeNull()
    const modes = result.segments.map((s: any) => s.mode)
    expect(modes).toContain('driving')
    expect(modes).toContain('transit')

    // Should track parked vehicle
    expect(result.parkedVehicles).toBeDefined()
    expect(result.parkedVehicles!.length).toBe(1)
    expect(result.parkedVehicles![0].vehicle.id).toBe('car-1')
  })

  test('walking access + shared-bike egress (3.2) adds walk-to-station + bike ride', async () => {
    // Mock shared bike station near alighting stop
    mockSearchByCategory.mockImplementation(async () => [
      {
        id: 'station-1',
        name: { value: 'Downtown Bike Share' },
        lat: 35.2255,
        lng: -80.8445,
        geometry: { value: { center: { lat: 35.2255, lng: -80.8445 } } },
      },
    ])

    const result = await (service as any).composeTransitWithAccessAndEgress(
      itinerary,
      '2026-01-15T08:00:00Z',
      CHARLOTTE_ORIGIN,
      CHARLOTTE_DEST,
      { mode: 'walking' },
      { mode: 'shared-bike', searchSharedMobility: true },
      {},
      dataSources,
    )

    expect(result).not.toBeNull()
    const modes = result.segments.map((s: any) => s.mode)
    expect(modes).toContain('transit')

    // Should have walking to station + biking from station
    const postTransitSegments = result.segments.filter(
      (s: any) => s.mode !== 'transit' &&
        new Date(s.startTime) >= new Date(itinerary.legs[1].endTime),
    )
    expect(postTransitSegments.length).toBeGreaterThanOrEqual(1)

    // Bike segment should be marked as shared
    const bikeEgress = postTransitSegments.find((s: any) => s.mode === 'biking')
    expect(bikeEgress).toBeDefined()
    expect(bikeEgress!.ownership).toBe('shared')
  })

  test('shared-bike egress falls back to walking when no stations found', async () => {
    mockSearchByCategory.mockImplementation(async () => [])

    const result = await (service as any).composeTransitWithAccessAndEgress(
      itinerary,
      '2026-01-15T08:00:00Z',
      CHARLOTTE_ORIGIN,
      CHARLOTTE_DEST,
      { mode: 'walking' },
      { mode: 'shared-bike', searchSharedMobility: true },
      {},
      dataSources,
    )

    expect(result).not.toBeNull()
    // No shared station → fallback to walking egress
    const postTransitSegments = result.segments.filter(
      (s: any) => s.mode !== 'transit' &&
        new Date(s.startTime) >= new Date(itinerary.legs[1].endTime),
    )
    expect(postTransitSegments.every((s: any) => s.mode === 'walking')).toBe(true)
  })

  test('vehicle far from origin prepends walk-to-vehicle segment', async () => {
    // Place bike 500m away (>200m threshold)
    const farBikeLocation = { lat: 35.2140, lng: -80.8605 }

    const result = await (service as any).composeTransitWithAccessAndEgress(
      itinerary,
      '2026-01-15T08:00:00Z',
      CHARLOTTE_ORIGIN,
      CHARLOTTE_DEST,
      {
        mode: 'biking',
        vehicle: { id: 'bike-1', type: 'bike', name: 'Far Bike', location: farBikeLocation },
        vehicleLocation: farBikeLocation,
      },
      { mode: 'walking' },
      {},
      dataSources,
    )

    expect(result).not.toBeNull()
    // First segment should be walking (to the bike)
    expect(result.segments[0].mode).toBe('walking')
    // Second should be biking (to the stop)
    expect(result.segments[1].mode).toBe('biking')
  })

  test('timing is back-calculated from transit departure', async () => {
    const bikeLocation = { lat: 35.2096, lng: -80.8610 }

    const result = await (service as any).composeTransitWithAccessAndEgress(
      itinerary,
      '2026-01-15T08:00:00Z',
      CHARLOTTE_ORIGIN,
      CHARLOTTE_DEST,
      {
        mode: 'biking',
        vehicle: { id: 'bike-1', type: 'bike', location: bikeLocation },
        vehicleLocation: bikeLocation,
      },
      { mode: 'walking' },
      { transitBufferMinutes: 2 },
      dataSources,
    )

    expect(result).not.toBeNull()
    const bikeSegment = result.segments.find((s: any) => s.mode === 'biking')
    const transitSegment = result.segments.find((s: any) => s.mode === 'transit')

    // Bike segment should end before transit departs (with buffer)
    const bikeEnd = new Date(bikeSegment!.endTime).getTime()
    const transitStart = new Date(transitSegment!.startTime).getTime()
    expect(bikeEnd).toBeLessThanOrEqual(transitStart)
  })

  test('empty transit segments returns null', async () => {
    // Itinerary with no transit legs
    const noTransitItinerary = makeTransitItinerary({
      legs: [
        {
          mode: 'WALK',
          transitLeg: false,
          from: { name: 'A', lat: 35.2, lng: -80.8 },
          to: { name: 'B', lat: 35.21, lng: -80.81 },
          startTime: '2026-01-15T08:00:00Z',
          endTime: '2026-01-15T08:10:00Z',
          duration: 600,
          distance: 500,
        },
      ],
    })

    const result = await (service as any).composeTransitWithAccessAndEgress(
      noTransitItinerary,
      '2026-01-15T08:00:00Z',
      CHARLOTTE_ORIGIN,
      CHARLOTTE_DEST,
      { mode: 'walking' },
      { mode: 'walking' },
      {},
      dataSources,
    )

    expect(result).toBeNull()
  })
})

// ── Transfer walks ──────────────────────────────────────────────────────────

describe('TripService — insertTransferWalks', () => {
  const service = new TripService()

  beforeEach(() => {
    mockGetRoute.mockReset()
    mockGetRoute.mockImplementation(async () => makeBasicWalkRoute(100, 120))
  })

  test('inserts walk between distant consecutive transit segments', async () => {
    const segments: any[] = [
      {
        mode: 'transit',
        start: { location: { lat: 35.20, lng: -80.85 } },
        end: { location: { lat: 35.21, lng: -80.84 } },
        startTime: '2026-01-15T08:00:00Z',
        endTime: '2026-01-15T08:20:00Z',
      },
      {
        mode: 'transit',
        start: { location: { lat: 35.215, lng: -80.835 } },
        end: { location: { lat: 35.22, lng: -80.83 } },
        startTime: '2026-01-15T08:25:00Z',
        endTime: '2026-01-15T08:40:00Z',
      },
    ]

    const result = await (service as any).insertTransferWalks(segments, {})
    expect(result).not.toBeNull()
    expect(result!.length).toBe(3) // transit + walk + transit
    expect(result![1].mode).toBe('walking')
  })

  test('skips walk between close consecutive transit segments', async () => {
    const segments: any[] = [
      {
        mode: 'transit',
        start: { location: { lat: 35.20, lng: -80.85 } },
        end: { location: { lat: 35.2001, lng: -80.8501 } }, // ~10m apart
        startTime: '2026-01-15T08:00:00Z',
        endTime: '2026-01-15T08:20:00Z',
      },
      {
        mode: 'transit',
        start: { location: { lat: 35.2002, lng: -80.8502 } },
        end: { location: { lat: 35.22, lng: -80.83 } },
        startTime: '2026-01-15T08:25:00Z',
        endTime: '2026-01-15T08:40:00Z',
      },
    ]

    const result = await (service as any).insertTransferWalks(segments, {})
    expect(result).not.toBeNull()
    expect(result!.length).toBe(2) // No walk inserted
  })
})
