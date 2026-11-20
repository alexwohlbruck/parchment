import { beforeEach, describe, expect, mock, test } from 'bun:test'
import type { AskEvent } from '../../types/ask.types'
import type { AskContext } from './ask-tool-base'

let permissions = ['library:write']
mock.module('../auth.service', () => ({
  getPermissions: async () => permissions,
  hasPermission: (held: string[], rule: string) => held.includes(rule),
}))

const leg = (mode: string, from: [number, number], to: [number, number]) => ({
  mode,
  geometry: [{ lat: from[0], lng: from[1] }, { lat: to[0], lng: to[1] }],
  distance: 5000,
  duration: 1200,
  totalElevationGain: 40,
})
const mockPlanTrip = mock(async (_request: any, _userId?: string) => ({
  trips: [
    { trip: { segments: [leg('walking', [40.68, -73.96], [40.7, -74])], tripStats: { totalDistance: 9000, totalDuration: 7200 } } },
    { trip: { segments: [leg('biking', [40.68, -73.96], [40.7, -74])], tripStats: { totalDistance: 30000, totalDuration: 7200 } } },
  ],
}))
mock.module('../planned-trip.service', () => ({ planTripFor: mockPlanTrip, hasPremiumNavigation: async () => false }))

const mockUpdateRoute = mock(async (_id: string, _userId: string, _updates: any) => ({}))
const saved = {
  id: 'route-1',
  mode: 'cycling',
  scheme: 'server-key',
  body: {
    name: 'Manhattan loop',
    waypoints: [{ lat: 40.68, lng: -73.96, name: 'Home' }, { lat: 40.8, lng: -73.93 }],
    geometry: [],
    stats: { distance: 30000, duration: 7200 },
  },
}
mock.module('../library/routes.service', () => ({
  getRouteById: mock(async (id: string) => (id === 'route-1' ? saved : undefined)),
  createRoute: mock(async () => ({ id: 'route-1' })),
  updateRoute: mockUpdateRoute,
  getRoutes: mock(async () => [
    { id: 'mine', mode: 'walking', archivedAt: null, body: { waypoints: [{ name: 'Pier 25' }, { name: 'Battery Park' }], geometry: [], stats: { distance: 2000, duration: 1500 } } },
    { id: 'old', mode: 'cycling', archivedAt: new Date(), body: { waypoints: [], geometry: [] } },
  ]),
}))
mock.module('../geocoding.service', () => ({
  forwardGeocode: async () => ({ results: [] }),
  reverseGeocode: async () => ({ results: [] }),
}))
mock.module('../place.service', () => ({ lookupEnrichedPlaceById: async () => null }))

const { routeTools } = await import('./ask-route-tools')
const tool = (name: string) => routeTools.find((t) => t.name === name)!

const home = { name: 'Home', lat: 40.68, lng: -73.96 }

function context(events: AskEvent[] = []): AskContext {
  return {
    userId: 'u1',
    language: 'en-US',
    places: new Map([['home', home]]),
    units: 'metric',
    vehicles: [],
    routingPreferences: { hills: 0.2, useKnownParkingLocations: true },
    now: new Date('2026-11-20T15:00:00Z'),
    seen: new Map(),
    routes: new Map(),
    sources: new Map(),
    emit: (event) => events.push(event),
  }
}

beforeEach(() => {
  permissions = ['library:write']
  mockPlanTrip.mockClear()
  mockUpdateRoute.mockClear()
})

describe('create_route', () => {
  test('snaps a loop on the bike tab and saves it as a library route', async () => {
    const events: AskEvent[] = []
    const ctx = context(events)
    const result = await tool('create_route').run(
      { name: 'Manhattan loop', points: ['home', { lat: 40.8, lng: -73.93, name: "Randall's Island" }], loop: true },
      ctx,
    )

    const request = mockPlanTrip.mock.calls[0][0]
    expect(request.selectedMode).toBe('biking')
    expect(request.excludedModes).toContain('bikeshare')
    expect(request.routingPreferences).toEqual({ hills: 0.2, useKnownParkingLocations: false })
    expect(request.waypoints.map((w: any) => [w.type, w.label])).toEqual([
      ['origin', 'Home'],
      ['via', "Randall's Island"],
      ['destination', 'Home'],
    ])

    const saved = mockUpdateRoute.mock.calls[0][2]
    expect(saved.body.name).toBe('Manhattan loop')
    expect(saved.body.segments.map((s: any) => s.mode)).toEqual(['biking'])
    expect(saved).toMatchObject({ distance: 30000, duration: 7200, elevationGain: 40 })

    expect(result).toEqual({ saved: true, id: 'route-1', name: 'Manhattan loop', distance: '30.0 km', minutes: 120, climb: '40 m' })
    expect(events).toEqual([
      { type: 'route', id: 'route-1', name: 'Manhattan loop', mode: 'cycling', distance: 30000, duration: 7200, elevationGain: 40 },
    ])
    expect(ctx.routes.has('route-1')).toBe(true)
  })

  test('needs two points and a library', async () => {
    await expect(tool('create_route').run({ name: 'x', points: ['home'] }, context())).rejects.toThrow('at least 2')
    permissions = []
    await expect(tool('create_route').run({ name: 'x', points: ['home', 'home'] }, context())).rejects.toThrow(
      'Basic or Premium',
    )
  })
})

describe('edit_route', () => {
  test('renames without routing again', async () => {
    const result = await tool('edit_route').run({ id: 'route-1', name: 'Island loop' }, context())
    expect(mockPlanTrip).not.toHaveBeenCalled()
    expect(mockUpdateRoute.mock.calls[0][2].body).toMatchObject({ name: 'Island loop', waypoints: saved.body.waypoints })
    expect(result).toMatchObject({ saved: true, id: 'route-1', name: 'Island loop', distance: '30.0 km' })
  })

  test('re-snaps its own points for another mode', async () => {
    const events: AskEvent[] = []
    await tool('edit_route').run({ id: 'route-1', mode: 'walking' }, context(events))
    const request = mockPlanTrip.mock.calls[0][0]
    expect(request.selectedMode).toBe('walking')
    expect(request.waypoints.map((w: any) => w.label)).toEqual(['Home', ''])
    expect(mockUpdateRoute.mock.calls[0][2]).toEqual({ mode: 'walking' })
    expect(events[0]).toMatchObject({ type: 'route', id: 'route-1', mode: 'walking', name: 'Manhattan loop' })
  })

  test('refuses a route it cannot read', async () => {
    await expect(tool('edit_route').run({ id: 'elsewhere', name: 'x' }, context())).rejects.toThrow("Can't change route")
  })
})

describe('my_routes', () => {
  test('lists live routes, named by their ends when the name is encrypted', async () => {
    expect(await tool('my_routes').run({}, context())).toEqual([
      { id: 'mine', name: 'Pier 25 to Battery Park', mode: 'walking', distance: '2.0 km', minutes: 25, stops: 2 },
    ])
  })
})
