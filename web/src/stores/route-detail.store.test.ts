/**
 * Unit tests for the route-detail store.
 *
 * Tests the vehicle projection, direction filtering, and state
 * management logic. Mocks the API layer.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useRouteDetailStore, type RouteDetailStop, type VehicleOnRoute } from './route-detail.store'
import type { TransitVehiclePosition } from '@/types/multimodal.types'

// Mock the API and realtime modules
vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ data: { vehicles: [] } }),
  },
}))

vi.mock('@/lib/realtime', () => ({
  send: vi.fn(),
  connectionState: { value: 'open' },
}))

vi.mock('@/lib/realtime-events', () => ({
  registerRealtimeHandlers: vi.fn(),
}))

function makeStop(id: string, name: string, lat: number, lng: number, dist: number): RouteDetailStop {
  return { stopId: id, stopName: name, lat, lng, distanceAlongRoute: dist }
}

function makeVehicle(
  id: string,
  lat: number,
  lng: number,
  opts: Partial<TransitVehiclePosition> = {},
): TransitVehiclePosition {
  return {
    vehicleId: id,
    feedId: '886',
    position: { lat, lng },
    timestamp: new Date().toISOString(),
    ...opts,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('route-detail store state management', () => {
  test('isActive is false by default', () => {
    const store = useRouteDetailStore()
    expect(store.isActive).toBe(false)
    expect(store.activeRoute).toBeNull()
  })

  test('closeRoute clears all state', () => {
    const store = useRouteDetailStore()
    store.selectVehicle('test-123')
    store.closeRoute()
    expect(store.selectedVehicleId).toBeNull()
    expect(store.vehicles.size).toBe(0)
    expect(store.isActive).toBe(false)
  })

  test('selectVehicle and deselect', () => {
    const store = useRouteDetailStore()
    store.selectVehicle('v1')
    expect(store.selectedVehicleId).toBe('v1')
    store.selectVehicle(null)
    expect(store.selectedVehicleId).toBeNull()
  })

  test('setDirection updates activeDirection', () => {
    const store = useRouteDetailStore()
    store.setDirection('North to UNCC')
    expect(store.selectedDirection).toBe('North to UNCC')
  })
})

describe('direction derivation', () => {
  test('derives directions from first/last stop when no departure context', () => {
    const store = useRouteDetailStore()
    // Simulate setting activeRoute directly for testing
    ;(store as any).activeRoute = {
      feedId: '886',
      routeId: '510',
      routeShortName: '510',
      routeLongName: 'Gold Line',
      routeColor: null,
      routeTextColor: null,
      routeType: 0,
      agencyName: null,
      stops: [
        makeStop('1', 'Sunnyside', 35.22, -80.83, 0),
        makeStop('2', 'Middle', 35.23, -80.84, 500),
        makeStop('3', 'French St', 35.24, -80.85, 1000),
      ],
      coordinates: null,
      relatedRouteIds: [],
    }

    expect(store.directions).toHaveLength(2)
    expect(store.directions[0]).toBe('To French St')
    expect(store.directions[1]).toBe('To Sunnyside')
  })
})

describe('displayStops direction reversal', () => {
  test('displayStops reverses when second direction is selected', () => {
    const store = useRouteDetailStore()
    ;(store as any).activeRoute = {
      feedId: '886',
      routeId: '510',
      routeShortName: '510',
      routeLongName: 'Gold Line',
      routeColor: null,
      routeTextColor: null,
      routeType: 0,
      agencyName: null,
      stops: [
        makeStop('1', 'First', 35.22, -80.83, 0),
        makeStop('2', 'Second', 35.23, -80.84, 500),
        makeStop('3', 'Third', 35.24, -80.85, 1000),
      ],
      coordinates: null,
      relatedRouteIds: [],
    }

    // Default direction (first) — original order
    expect(store.displayStops[0].stopName).toBe('First')
    expect(store.displayStops[2].stopName).toBe('Third')

    // Switch to second direction — reversed
    store.setDirection(store.directions[1])
    expect(store.displayStops[0].stopName).toBe('Third')
    expect(store.displayStops[2].stopName).toBe('First')
  })
})

/**
 * The timeline draws the path the train is taking, not the timetable it
 * belongs to. The anchor is the R after midnight: its list runs Forest Hills
 * to Bay Ridge, but the train is the Whitehall–Bay Ridge shuttle.
 */
describe('displayStops follows the running path', () => {
  const openRoute = (store: ReturnType<typeof useRouteDetailStore>) => {
    ;(store as any).activeRoute = {
      feedId: '5',
      routeId: 'R',
      routeShortName: 'R',
      routeLongName: 'Broadway Local',
      routeColor: null,
      routeTextColor: null,
      routeType: 1,
      agencyName: null,
      stops: [
        makeStop('R16', 'Times Sq', 40.75, -73.98, 0),
        makeStop('R23', 'Canal St', 40.71, -74.0, 500),
        makeStop('R27', 'Whitehall St', 40.70, -74.01, 1000),
        makeStop('R31', 'Atlantic Av', 40.68, -73.97, 1500),
      ],
      coordinates: null,
      relatedRouteIds: [],
    }
  }

  /** What loadStopService leaves behind: a board read at each stop. */
  const boardsSay = (
    store: ReturnType<typeof useRouteDetailStore>,
    answers: Record<string, string[]>,
  ) => {
    store.stopRunningRoutes = new Map(
      Object.entries(answers).map(([stopId, ids]) => [stopId, new Set(ids)]),
    )
    store.stopServiceKnown = new Set(Object.keys(answers))
  }

  test('drops the stops the line is not calling at', () => {
    const store = useRouteDetailStore()
    openRoute(store)
    boardsSay(store, {
      R16: ['N', 'Q'],
      R23: ['N', 'Q'],
      R27: ['R', 'N'],
      R31: ['R', 'D'],
    })
    expect(store.displayStops.map(s => s.stopId)).toEqual(['R27', 'R31'])
  })

  test('keeps a stop whose board was never read', () => {
    const store = useRouteDetailStore()
    openRoute(store)
    boardsSay(store, { R16: ['N'], R27: ['R'] })
    // R23 and R31 are unanswered — missing evidence, not a closed station.
    expect(store.displayStops.map(s => s.stopId)).toEqual(['R23', 'R27', 'R31'])
  })

  test('draws the whole line when nothing is running', () => {
    const store = useRouteDetailStore()
    openRoute(store)
    boardsSay(store, { R16: ['N'], R23: ['N'], R27: ['N'], R31: ['D'] })
    // A path of no stops describes nothing; the timetable is the better answer.
    expect(store.displayStops).toHaveLength(4)
  })

  test('routeStops stays the whole line, so the next board is asked in full', () => {
    const store = useRouteDetailStore()
    openRoute(store)
    boardsSay(store, { R16: ['N'], R23: ['N'], R27: ['R'], R31: ['R'] })
    expect(store.displayStops).toHaveLength(2)
    expect(store.routeStops).toHaveLength(4)
  })

  test('an alert naming a stop overrides its board — inside the run', () => {
    // The parade day: Grand Army Plaza's board answers "2, 3" because the
    // reroute never reached the schedule, but the agency's alert names the
    // stop, and it lies between stops the boards confirm. Alerts name
    // stations ("237"); the list carries platforms.
    const store = useRouteDetailStore()
    openRoute(store)
    ;(store as any).activeRoute.stops = [
      makeStop('R16', 'Times Sq', 40.75, -73.98, 0),
      { ...makeStop('237N', 'Grand Army Plaza', 40.68, -73.97, 500), parentStation: '237' },
      { ...makeStop('238N', 'Eastern Pkwy', 40.67, -73.96, 1000), parentStation: '238' },
      makeStop('250N', 'Crown Hts-Utica Av', 40.66, -73.93, 1500),
    ]
    // The named stops sit on the line's own track.
    ;(store as any).activeRoute.coordinates = [
      [-73.98, 40.75], [-73.97, 40.68], [-73.96, 40.67], [-73.93, 40.66],
    ]
    boardsSay(store, { R16: ['R'], '237N': ['2', '3'], '238N': ['2', '3'], '250N': ['R'] })
    store.setAlertOverrides({ serves: new Set(['237', '238']), skips: new Set(['238']) })
    // 237 forced on by the alert; 238 named by both, and the skip wins.
    expect(store.displayStops.map(s => s.stopId)).toEqual(['R16', '237N', '250N'])
  })

  test('an alert cannot extend the line past its board-confirmed end', () => {
    // The same parade alert named the whole New Lots branch in its informed
    // entities while its text said "between Atlantic Av and Crown Hts-Utica
    // Av" — and no board ever saw a 4 past Utica. Entities beyond the last
    // confirmed stop are the agency's filing habit, not a service claim.
    const store = useRouteDetailStore()
    openRoute(store)
    ;(store as any).activeRoute.stops = [
      makeStop('R16', 'Atlantic Av', 40.68, -73.98, 0),
      { ...makeStop('250N', 'Crown Hts-Utica Av', 40.66, -73.93, 500), parentStation: '250' },
      { ...makeStop('251N', 'Sutter Av', 40.63, -73.92, 1000), parentStation: '251' },
      { ...makeStop('257N', 'New Lots Av', 40.63, -73.88, 1500), parentStation: '257' },
    ]
    // The shape ends at Utica; the branch stops are far off it.
    ;(store as any).activeRoute.coordinates = [[-73.98, 40.68], [-73.93, 40.66]]
    boardsSay(store, { R16: ['R'], '250N': ['R'], '251N': ['2', '3'], '257N': ['2', '3'] })
    store.setAlertOverrides({ serves: new Set(['251', '257']), skips: new Set() })
    expect(store.displayStops.map(s => s.stopId)).toEqual(['R16', '250N'])
  })

  test('pathLeavesTrack: an end cut short is a break', () => {
    // The overnight R: everything north of Whitehall unserved. The ribbon's
    // masks may or may not know; the map must not rely on them.
    const store = useRouteDetailStore()
    openRoute(store)
    boardsSay(store, { R16: ['N'], R23: ['N'], R27: ['R'], R31: ['R'] })
    expect(store.pathLeavesTrack).toBe(true)
  })

  test('pathLeavesTrack: a branch off the running track is a break', () => {
    // Parade day: the Sunday timetable runs the 4 to New Lots, the boards
    // say every train turns at Utica. The branch stops sit a kilometre off
    // the canonical shape yet inside the list's distance span.
    const store = useRouteDetailStore()
    openRoute(store)
    ;(store as any).activeRoute.stops = [
      makeStop('250N', 'Crown Hts-Utica Av', 40.6689, -73.9329, 0),
      makeStop('251N', 'Sutter Av', 40.6646, -73.9226, 0),
      makeStop('239N', 'Grand Army Plaza', 40.6751, -73.9710, 500),
      makeStop('R16', 'Atlantic Av', 40.6841, -73.9779, 1000),
    ]
    ;(store as any).activeRoute.coordinates = [
      [-73.9329, 40.6689], [-73.9710, 40.6751], [-73.9779, 40.6841],
    ]
    boardsSay(store, { '250N': ['R'], '251N': ['3'], '239N': ['R'], R16: ['R'] })
    expect(store.displayStops.map(s => s.stopId)).toEqual(['250N', '239N', 'R16'])
    expect(store.pathLeavesTrack).toBe(true)
  })

  test('pathLeavesTrack: a middle skip is not a break', () => {
    // A skipped stop is passed on the same rails — the line is unbroken.
    const store = useRouteDetailStore()
    openRoute(store)
    boardsSay(store, { R16: ['R'], R23: ['N'], R27: ['R'], R31: ['R'] })
    expect(store.displayStops.map(s => s.stopId)).toEqual(['R16', 'R27', 'R31'])
    expect(store.pathLeavesTrack).toBe(false)
  })

  test('an alert skip empties a stop the board still lists', () => {
    // Parade day at Eastern Pkwy: the board reads the schedule and lists
    // 2s and 3s; the agency's detour says all three lines skip it.
    const store = useRouteDetailStore()
    openRoute(store)
    ;(store as any).activeRoute.stops = [
      makeStop('R16', 'Atlantic Av', 40.68, -73.98, 0),
      { ...makeStop('238N', 'Eastern Pkwy', 40.67, -73.96, 500), parentStation: '238' },
      makeStop('R31', 'Utica Av', 40.66, -73.93, 1000),
    ]
    boardsSay(store, { R16: ['R'], '238N': ['R', '2'], R31: ['R'] })
    store.setStopSkips(new Map([['238', new Set(['R', '2'])]]))
    // matched through the parent: the alert names the station, the board
    // answered for the platform
    expect(store.runningAtStops.get('238N')?.size).toBe(0)
    expect(store.runningAtStops.get('R16')?.has('R')).toBe(true)
    // and the path drops the stop, because the board's effective answer
    // no longer names this line there
    expect(store.displayStops.map(s => s.stopId)).toEqual(['R16', 'R31'])
  })

  test('the running path reverses with the direction', () => {
    const store = useRouteDetailStore()
    openRoute(store)
    boardsSay(store, { R16: ['N'], R23: ['N'], R27: ['R'], R31: ['R'] })
    store.setDirection(store.directions[1])
    expect(store.displayStops.map(s => s.stopId)).toEqual(['R31', 'R27'])
  })
})

describe('vehicle projection', () => {
  test('vehiclesOnRoute is empty when no vehicles', () => {
    const store = useRouteDetailStore()
    ;(store as any).activeRoute = {
      feedId: '886',
      routeId: '510',
      routeShortName: '510',
      routeLongName: 'Gold Line',
      routeColor: null,
      routeTextColor: null,
      routeType: 0,
      agencyName: null,
      stops: [
        makeStop('1', 'A', 35.22, -80.83, 0),
        makeStop('2', 'B', 35.24, -80.85, 1000),
      ],
      coordinates: null,
      relatedRouteIds: [],
    }

    expect(store.vehiclesOnRoute).toHaveLength(0)
  })

  test('vehicleList reflects vehicles set on the store', () => {
    const store = useRouteDetailStore()
    expect(store.vehicleList).toHaveLength(0)

    ;(store as any).vehicles = new Map([
      ['v1', makeVehicle('v1', 35.22, -80.82, { routeId: '510' })],
      ['v2', makeVehicle('v2', 35.23, -80.83, { routeId: '510' })],
    ])

    expect(store.vehicleList).toHaveLength(2)
  })
})

describe('stopTimeMap', () => {
  test('empty when no trip stop times', () => {
    const store = useRouteDetailStore()
    expect(store.stopTimeMap.size).toBe(0)
  })
})

describe('generation counter guards', () => {
  test('closeRoute resets state even during loading', () => {
    const store = useRouteDetailStore()
    ;(store as any).isLoading = true
    store.closeRoute()
    expect(store.isActive).toBe(false)
    expect(store.vehicles.size).toBe(0)
  })
})
