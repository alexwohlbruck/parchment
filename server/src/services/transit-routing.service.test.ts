import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ── Mock dependencies before imports ─────────────────────────────────────────

const mockGetConfiguredIntegrationsByCapability = mock(
  (_capabilityId: any) => [] as any[],
)
const mockGetCachedIntegrationInstance = mock((_record: any) => null as any)

mock.module('./integrations', () => ({
  integrationManager: {
    getConfiguredIntegrationsByCapability:
      mockGetConfiguredIntegrationsByCapability,
    getCachedIntegrationInstance: mockGetCachedIntegrationInstance,
  },
}))

// ── Import under test (after mocks) ──────────────────────────────────────────

const { TransitRoutingService } = await import('./transit-routing.service')

// ── Test fixtures ────────────────────────────────────────────────────────────

function makeIntegrationRecord(overrides: Record<string, any> = {}) {
  return {
    id: 'test-record-1',
    integrationId: 'barrelman',
    capabilities: [{ id: 'transitRouting', active: true }],
    ...overrides,
  }
}

function makeTransitRouteResponse() {
  return {
    itineraries: [
      {
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
            from: { name: 'Origin', lat: 35.2, lng: -80.8 },
            to: { name: 'Stop A', lat: 35.21, lng: -80.81, stopId: 'stop-a' },
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
              lng: -80.81,
              stopId: 'stop-a',
            },
            to: {
              name: 'Stop B',
              lat: 35.22,
              lng: -80.82,
              stopId: 'stop-b',
            },
            startTime: '2026-01-15T08:05:00Z',
            endTime: '2026-01-15T08:25:00Z',
            duration: 1200,
            distance: 5000,
            routeShortName: '9X',
            routeLongName: 'Express Downtown',
            routeColor: '0000FF',
            headsign: 'Downtown',
            agencyName: 'Charlotte CATS',
          },
          {
            mode: 'WALK',
            transitLeg: false,
            from: {
              name: 'Stop B',
              lat: 35.22,
              lng: -80.82,
              stopId: 'stop-b',
            },
            to: { name: 'Destination', lat: 35.23, lng: -80.83 },
            startTime: '2026-01-15T08:25:00Z',
            endTime: '2026-01-15T08:30:00Z',
            duration: 300,
            distance: 250,
          },
        ],
      },
    ],
    metadata: { searchWindow: 3600 },
  }
}

function makeNearbyStops() {
  return [
    {
      stopId: 'stop-a',
      feedId: 'cats',
      stopName: 'Stop A',
      stopCode: null,
      lat: 35.21,
      lng: -80.81,
      distance: 120,
      locationType: 0,
      parentStation: null,
      wheelchairBoarding: 1,
      platformCode: null,
    },
  ]
}

function makeStopRoutes() {
  return [
    {
      routeId: 'route-9x',
      feedId: 'cats',
      routeShortName: '9X',
      routeLongName: 'Express Downtown',
      routeType: 3,
      routeColor: '0000FF',
      routeTextColor: 'FFFFFF',
      agencyName: 'Charlotte CATS',
    },
  ]
}

// ── Setup ────────────────────────────────────────────────────────────────────

let service: InstanceType<typeof TransitRoutingService>

beforeEach(() => {
  mockGetConfiguredIntegrationsByCapability.mockReset()
  mockGetCachedIntegrationInstance.mockReset()
  service = new TransitRoutingService()
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe('TransitRoutingService', () => {
  describe('getTransitRoute', () => {
    test('delegates to capability and returns response', async () => {
      const record = makeIntegrationRecord()
      const expected = makeTransitRouteResponse()
      const mockGetTransitRoute = mock(async () => expected)

      mockGetConfiguredIntegrationsByCapability.mockReturnValue([record])
      mockGetCachedIntegrationInstance.mockReturnValue({
        capabilities: {
          transitRouting: { getTransitRoute: mockGetTransitRoute },
        },
      })

      const result = await service.getTransitRoute({
        from: { lat: 35.2, lng: -80.8 },
        to: { lat: 35.23, lng: -80.83 },
      })

      expect(result).toBe(expected)
      expect(mockGetTransitRoute).toHaveBeenCalledTimes(1)
      expect(mockGetTransitRoute).toHaveBeenCalledWith({
        from: { lat: 35.2, lng: -80.8 },
        to: { lat: 35.23, lng: -80.83 },
      })
    })

    test('passes all optional parameters through', async () => {
      const record = makeIntegrationRecord()
      const mockGetTransitRoute = mock(async () =>
        makeTransitRouteResponse(),
      )

      mockGetConfiguredIntegrationsByCapability.mockReturnValue([record])
      mockGetCachedIntegrationInstance.mockReturnValue({
        capabilities: {
          transitRouting: { getTransitRoute: mockGetTransitRoute },
        },
      })

      const request = {
        from: { lat: 35.2, lng: -80.8 },
        to: { lat: 35.23, lng: -80.83 },
        time: '2026-01-15T08:00:00Z',
        arriveBy: true,
        numItineraries: 3,
        transitModes: ['BUS', 'RAIL'],
        maxWalkDistance: 1000,
        maxTransfers: 2,
        wheelchair: true,
      }

      await service.getTransitRoute(request)
      expect(mockGetTransitRoute).toHaveBeenCalledWith(request)
    })

    test('throws when no transit routing integrations configured', async () => {
      mockGetConfiguredIntegrationsByCapability.mockReturnValue([])

      await expect(
        service.getTransitRoute({
          from: { lat: 35.2, lng: -80.8 },
          to: { lat: 35.23, lng: -80.83 },
        }),
      ).rejects.toThrow('No transit routing integrations configured')
    })

    test('throws when integration instance is null', async () => {
      const record = makeIntegrationRecord()
      mockGetConfiguredIntegrationsByCapability.mockReturnValue([record])
      mockGetCachedIntegrationInstance.mockReturnValue(null)

      await expect(
        service.getTransitRoute({
          from: { lat: 35.2, lng: -80.8 },
          to: { lat: 35.23, lng: -80.83 },
        }),
      ).rejects.toThrow('not available or not initialized')
    })

    test('throws when transitRouting capability missing', async () => {
      const record = makeIntegrationRecord()
      mockGetConfiguredIntegrationsByCapability.mockReturnValue([record])
      mockGetCachedIntegrationInstance.mockReturnValue({
        capabilities: {},
      })

      await expect(
        service.getTransitRoute({
          from: { lat: 35.2, lng: -80.8 },
          to: { lat: 35.23, lng: -80.83 },
        }),
      ).rejects.toThrow('not available or not initialized')
    })

    test('propagates capability errors', async () => {
      const record = makeIntegrationRecord()
      mockGetConfiguredIntegrationsByCapability.mockReturnValue([record])
      mockGetCachedIntegrationInstance.mockReturnValue({
        capabilities: {
          transitRouting: {
            getTransitRoute: mock(async () => {
              throw new Error('MOTIS upstream timeout')
            }),
          },
        },
      })

      await expect(
        service.getTransitRoute({
          from: { lat: 35.2, lng: -80.8 },
          to: { lat: 35.23, lng: -80.83 },
        }),
      ).rejects.toThrow('MOTIS upstream timeout')
    })
  })

  describe('getNearbyStops', () => {
    test('delegates to capability and returns stops', async () => {
      const record = makeIntegrationRecord()
      const expected = makeNearbyStops()
      const mockGetNearbyStops = mock(async () => expected)

      mockGetConfiguredIntegrationsByCapability.mockReturnValue([record])
      mockGetCachedIntegrationInstance.mockReturnValue({
        capabilities: {
          transitRouting: { getNearbyStops: mockGetNearbyStops },
        },
      })

      const result = await service.getNearbyStops({
        lat: 35.21,
        lng: -80.81,
        radius: 500,
      })

      expect(result).toBe(expected)
      expect(mockGetNearbyStops).toHaveBeenCalledWith({
        lat: 35.21,
        lng: -80.81,
        radius: 500,
      })
    })

    test('throws when no transit routing integrations configured', async () => {
      mockGetConfiguredIntegrationsByCapability.mockReturnValue([])

      await expect(
        service.getNearbyStops({ lat: 35.21, lng: -80.81 }),
      ).rejects.toThrow('No transit routing integrations configured')
    })
  })

  describe('getRoutesForStop', () => {
    test('delegates to capability and returns routes', async () => {
      const record = makeIntegrationRecord()
      const expected = makeStopRoutes()
      const mockGetRoutesForStop = mock(async () => expected)

      mockGetConfiguredIntegrationsByCapability.mockReturnValue([record])
      mockGetCachedIntegrationInstance.mockReturnValue({
        capabilities: {
          transitRouting: { getRoutesForStop: mockGetRoutesForStop },
        },
      })

      const result = await service.getRoutesForStop('cats', 'stop-a')

      expect(result).toBe(expected)
      expect(mockGetRoutesForStop).toHaveBeenCalledWith('cats', 'stop-a')
    })

    test('throws when no transit routing integrations configured', async () => {
      mockGetConfiguredIntegrationsByCapability.mockReturnValue([])

      await expect(
        service.getRoutesForStop('cats', 'stop-a'),
      ).rejects.toThrow('No transit routing integrations configured')
    })
  })

  describe('isTransitRoutingAvailable', () => {
    test('returns true when integrations are configured', () => {
      mockGetConfiguredIntegrationsByCapability.mockReturnValue([
        makeIntegrationRecord(),
      ])
      expect(service.isTransitRoutingAvailable()).toBe(true)
    })

    test('returns false when no integrations configured', () => {
      mockGetConfiguredIntegrationsByCapability.mockReturnValue([])
      expect(service.isTransitRoutingAvailable()).toBe(false)
    })
  })

  describe('integration selection', () => {
    test('uses highest-priority integration (first in list)', async () => {
      const record1 = makeIntegrationRecord({ id: 'primary' })
      const record2 = makeIntegrationRecord({ id: 'fallback' })
      const mockGetTransitRoute = mock(async () =>
        makeTransitRouteResponse(),
      )

      mockGetConfiguredIntegrationsByCapability.mockReturnValue([
        record1,
        record2,
      ])
      mockGetCachedIntegrationInstance.mockReturnValue({
        capabilities: {
          transitRouting: { getTransitRoute: mockGetTransitRoute },
        },
      })

      await service.getTransitRoute({
        from: { lat: 35.2, lng: -80.8 },
        to: { lat: 35.23, lng: -80.83 },
      })

      // Should have been called with the first (highest-priority) record
      expect(mockGetCachedIntegrationInstance).toHaveBeenCalledWith(record1)
    })
  })
})
