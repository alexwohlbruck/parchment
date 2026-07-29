/**
 * Unit tests for the routing service.
 *
 * This is the seam between the legacy `costing` vocabulary the client still
 * sends and the unified request the integrations consume, so the mapping table
 * gets exercised directly — including the default for an unknown costing,
 * which must stay driving rather than throwing mid-trip-plan.
 *
 * The engine-selection rule also matters: an explicitly requested engine wins,
 * but asking for one that isn't configured falls back to the highest-priority
 * integration instead of failing the request.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { TravelMode, WaypointType } from '../types/unified-routing.types'

let configuredIntegrations: any[] = []
let instance: any = null

const getConfiguredIntegrationsByCapability = mock(
  (_capability: string) => configuredIntegrations,
)
const getCachedIntegrationInstance = mock((_record: any) => instance)

mock.module('./integrations', () => ({
  integrationManager: {
    getConfiguredIntegrationsByCapability,
    getCachedIntegrationInstance,
  },
}))

mock.module('../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
  logError: () => {},
  logWarn: () => {},
}))

const { RoutingService } = await import('./routing.service')

const unifiedRoute = { routes: [{ distance: 1000, duration: 600 }] }
const getRoute = mock(async (_request: any) => unifiedRoute as any)

/** Frontend sends coordinates as [lat, lng] pairs. */
const locations = [
  { value: [35.2, -80.8] },
  { value: [35.3, -80.9] },
] as any[]

let service: InstanceType<typeof RoutingService>

beforeEach(() => {
  configuredIntegrations = [{ integrationId: 'valhalla' }]
  instance = { capabilities: { routing: { getRoute } } }
  getRoute.mockClear()
  getRoute.mockImplementation(async () => unifiedRoute)
  getConfiguredIntegrationsByCapability.mockClear()
  getCachedIntegrationInstance.mockClear()
  service = new RoutingService()
})

describe('availability', () => {
  test('isRoutingAvailable is false with nothing configured', () => {
    configuredIntegrations = []

    expect(service.isRoutingAvailable()).toBe(false)
  })

  test('isRoutingAvailable is true once an engine is configured', () => {
    expect(service.isRoutingAvailable()).toBe(true)
  })

  test('lists the configured routing engine ids', () => {
    configuredIntegrations = [
      { integrationId: 'valhalla' },
      { integrationId: 'graphhopper' },
    ]

    expect(service.getAvailableRoutingIntegrations()).toEqual([
      'valhalla',
      'graphhopper',
    ])
  })
})

describe('getRoute — engine selection', () => {
  test('throws when no routing engine is configured', async () => {
    configuredIntegrations = []

    await expect(service.getRoute(locations)).rejects.toThrow(
      'No routing integrations configured',
    )
  })

  test('uses the first (highest-priority) engine by default', async () => {
    configuredIntegrations = [
      { integrationId: 'valhalla' },
      { integrationId: 'graphhopper' },
    ]

    await service.getRoute(locations)

    expect(getCachedIntegrationInstance.mock.calls[0][0]).toMatchObject({
      integrationId: 'valhalla',
    })
  })

  test('honours an explicitly requested engine', async () => {
    configuredIntegrations = [
      { integrationId: 'valhalla' },
      { integrationId: 'graphhopper' },
    ]

    await service.getRoute(locations, 'auto', { routingEngine: 'graphhopper' })

    expect(getCachedIntegrationInstance.mock.calls[0][0]).toMatchObject({
      integrationId: 'graphhopper',
    })
  })

  test('falls back to the default when the requested engine is absent', async () => {
    configuredIntegrations = [{ integrationId: 'valhalla' }]

    await service.getRoute(locations, 'auto', { routingEngine: 'osrm' } as any)

    expect(getCachedIntegrationInstance.mock.calls[0][0]).toMatchObject({
      integrationId: 'valhalla',
    })
  })

  test('throws when the engine has no cached instance', async () => {
    instance = null

    await expect(service.getRoute(locations)).rejects.toThrow(
      'not available or not initialized',
    )
  })

  test('throws when the instance lacks the routing capability', async () => {
    instance = { capabilities: {} }

    await expect(service.getRoute(locations)).rejects.toThrow(
      'not available or not initialized',
    )
  })
})

describe('getRoute — waypoint conversion', () => {
  test('converts [lat, lng] pairs into coordinates', async () => {
    await service.getRoute(locations)

    const { waypoints } = getRoute.mock.calls[0][0] as any
    expect(waypoints[0].coordinate).toEqual({ lat: 35.2, lng: -80.8 })
    expect(waypoints[1].coordinate).toEqual({ lat: 35.3, lng: -80.9 })
  })

  test('marks the endpoints as stops', async () => {
    await service.getRoute(locations)

    const { waypoints } = getRoute.mock.calls[0][0] as any
    expect(waypoints[0].type).toBe(WaypointType.STOP)
    expect(waypoints[1].type).toBe(WaypointType.STOP)
  })

  test('marks intermediate waypoints as via', async () => {
    await service.getRoute([
      { value: [1, 1] },
      { value: [2, 2] },
      { value: [3, 3] },
    ] as any[])

    const { waypoints } = getRoute.mock.calls[0][0] as any
    expect(waypoints.map((w: any) => w.type)).toEqual([
      WaypointType.STOP,
      WaypointType.VIA,
      WaypointType.STOP,
    ])
  })

  test('gives each waypoint a stable index-based id', async () => {
    await service.getRoute(locations)

    const { waypoints } = getRoute.mock.calls[0][0] as any
    expect(waypoints.map((w: any) => w.id)).toEqual(['waypoint-0', 'waypoint-1'])
  })

  test('always requests instructions and geometry', async () => {
    await service.getRoute(locations)

    const request = getRoute.mock.calls[0][0] as any
    expect(request.includeInstructions).toBe(true)
    expect(request.includeGeometry).toBe(true)
  })
})

describe('getRoute — costing to travel mode', () => {
  const cases: Array<[string, TravelMode]> = [
    ['auto', TravelMode.DRIVING],
    ['car', TravelMode.DRIVING],
    ['driving', TravelMode.DRIVING],
    ['bicycle', TravelMode.CYCLING],
    ['cycling', TravelMode.CYCLING],
    ['bike', TravelMode.CYCLING],
    ['pedestrian', TravelMode.WALKING],
    ['walking', TravelMode.WALKING],
    ['foot', TravelMode.WALKING],
    ['motorcycle', TravelMode.MOTORCYCLE],
    ['truck', TravelMode.TRUCK],
    ['transit', TravelMode.TRANSIT],
    ['wheelchair', TravelMode.WHEELCHAIR],
  ]

  for (const [costing, expected] of cases) {
    test(`maps "${costing}" to ${expected}`, async () => {
      await service.getRoute(locations, costing)

      expect((getRoute.mock.calls[0][0] as any).mode).toBe(expected)
    })
  }

  test('is case-insensitive', async () => {
    await service.getRoute(locations, 'BICYCLE')

    expect((getRoute.mock.calls[0][0] as any).mode).toBe(TravelMode.CYCLING)
  })

  test('falls back to driving for an unknown costing', async () => {
    // Reached mid-trip-plan; defaulting beats throwing.
    await service.getRoute(locations, 'hovercraft')

    expect((getRoute.mock.calls[0][0] as any).mode).toBe(TravelMode.DRIVING)
  })

  test('defaults to auto when no costing is supplied', async () => {
    await service.getRoute(locations)

    expect((getRoute.mock.calls[0][0] as any).mode).toBe(TravelMode.DRIVING)
  })
})

describe('getRoute — preference mapping', () => {
  test('optimizes for time by default', async () => {
    await service.getRoute(locations)

    expect((getRoute.mock.calls[0][0] as any).preferences.optimize).toBe('time')
  })

  test('optimizes for distance when shortest is requested', async () => {
    await service.getRoute(locations, 'auto', { shortest: true } as any)

    expect((getRoute.mock.calls[0][0] as any).preferences.optimize).toBe(
      'distance',
    )
  })

  test('passes the 0–1 range preferences through untouched', async () => {
    await service.getRoute(locations, 'auto', {
      highways: 0.2,
      tolls: 0,
      ferries: 1,
      hills: 0.5,
      surfaceQuality: 0.75,
      litPaths: 0.9,
      safetyVsSpeed: 0.3,
    } as any)

    expect((getRoute.mock.calls[0][0] as any).preferences).toMatchObject({
      highways: 0.2,
      tolls: 0,
      ferries: 1,
      hills: 0.5,
      surfaceQuality: 0.75,
      litPaths: 0.9,
      safetyVsSpeed: 0.3,
    })
  })

  test('renames the transit walk/transfer limits for the integration', async () => {
    await service.getRoute(locations, 'transit', {
      maxWalkingDistance: 800,
      maxTransfers: 2,
    } as any)

    const prefs = (getRoute.mock.calls[0][0] as any).preferences
    expect(prefs.maxWalkDistance).toBe(800)
    expect(prefs.maxTransfers).toBe(2)
  })

  test('translates preferPavedPaths into avoidUnpaved', async () => {
    await service.getRoute(locations, 'cycling', {
      preferPavedPaths: true,
    } as any)

    expect((getRoute.mock.calls[0][0] as any).preferences.avoidUnpaved).toBe(true)
  })

  test('leaves avoidUnpaved undefined when paved paths are not preferred', async () => {
    await service.getRoute(locations, 'cycling', {
      preferPavedPaths: false,
    } as any)

    expect(
      (getRoute.mock.calls[0][0] as any).preferences.avoidUnpaved,
    ).toBeUndefined()
  })

  test('forwards the language for localized instructions', async () => {
    await service.getRoute(locations, 'auto', { language: 'es-ES' } as any)

    expect((getRoute.mock.calls[0][0] as any).language).toBe('es-ES')
  })

  test('carries the legacy avoid booleans through for old clients', async () => {
    await service.getRoute(locations, 'auto', {
      avoidTolls: true,
      avoidHighways: true,
      avoidFerries: false,
    } as any)

    expect((getRoute.mock.calls[0][0] as any).preferences).toMatchObject({
      avoidTolls: true,
      avoidHighways: true,
      avoidFerries: false,
    })
  })
})

describe('getRoute — failures', () => {
  test('wraps an integration failure with context', async () => {
    getRoute.mockRejectedValueOnce(new Error('valhalla timeout'))

    await expect(service.getRoute(locations)).rejects.toThrow(
      'Failed to get route: valhalla timeout',
    )
  })

  test('handles a non-Error rejection', async () => {
    getRoute.mockRejectedValueOnce('something odd')

    await expect(service.getRoute(locations)).rejects.toThrow(
      'Failed to get route: Unknown error',
    )
  })

  test('returns the integration result unchanged on success', async () => {
    expect(await service.getRoute(locations)).toEqual(unifiedRoute)
  })
})
