import { describe, expect, it } from 'vitest'
import { decodeStreetGraph, nearestNode } from './streets/street-graph'
import { pathManeuvers, shortestPath, travelTimes } from './streets/street-router'
import { decodeTimetable, departuresFrom, localMidnight } from './transit/timetable'
import { planJourneys } from './transit/raptor'
import { buildPlaceIndex, searchPlaceIndex } from './search/place-index'
import { planOfflineTrips, stopNodesFor } from './offline-trips'
import { STREET_FLAGS, type StreetsPackage, type TimetablePackage } from '@/types/offline-package.types'

const F = STREET_FLAGS
const BOTH = F.FOOT | F.BIKE

/** A street package from plain nodes and edges, encoded the way Barrelman sends it. */
function streets(nodes: [number, number][], edges: [number, number, number, string?][]): StreetsPackage {
  const names: string[] = []
  const encoded: number[] = []
  let [px, py] = [0, 0]
  for (const [lng, lat] of nodes) {
    const [x, y] = [Math.round(lng * 1e6), Math.round(lat * 1e6)]
    encoded.push(x - px, y - py)
    ;[px, py] = [x, y]
  }
  const flat = edges.flatMap(([from, to, flags, name]) => {
    const [a, b] = [nodes[from], nodes[to]]
    const metres = Math.hypot((b[0] - a[0]) * 84_000, (b[1] - a[1]) * 111_000)
    let nameIndex = -1
    if (name) nameIndex = names.includes(name) ? names.indexOf(name) : names.push(name) - 1
    return [from, to, Math.round(metres * 10), flags, nameIndex, 0]
  })
  return { version: 1, bounds: [-1, -1, 1, 1], generatedAt: '', nodes: encoded, edges: flat, shapes: [], names }
}

// A plus-shaped block: west–east on Main St, a turn north onto Oak Ave at the middle.
const D = 0.001
const plus = streets(
  [[0, 0], [D, 0], [2 * D, 0], [D, D]],
  [
    [0, 1, BOTH, 'Main St'],
    [1, 2, BOTH, 'Main St'],
    [1, 3, F.FOOT | F.BIKE | F.BIKE_BACKWARD_ONLY, 'Oak Ave'],
  ],
)

describe('street routing', () => {
  const graph = decodeStreetGraph(plus)

  it('snaps to the nearest node and walks the streets between', () => {
    const from = nearestNode(graph, -0.0001, 0, 'walking')!
    const to = nearestNode(graph, D, D + 0.0001, 'walking')!
    const path = shortestPath(graph, from, to, 'walking')!
    expect(path.steps.map(s => s.edge)).toEqual([0, 2])
    expect(path.distance).toBeGreaterThan(150)
  })

  it('only takes a one-way street the wrong way when nothing else connects', () => {
    expect(travelTimes(graph, 0, 'cycling', 3600).has(3)).toBe(false)
    expect(travelTimes(graph, 3, 'cycling', 3600).has(0)).toBe(true)
    expect(shortestPath(graph, 0, 3, 'cycling')?.steps.map(s => s.edge)).toEqual([0, 2])
  })

  it('names a turn where the street changes', () => {
    const path = shortestPath(graph, 0, 3, 'walking')!
    const steps = pathManeuvers(graph, path, 'walking')
    expect(steps.map(s => [s.type, s.modifier, s.streetName])).toEqual([
      ['depart', undefined, 'Main St'],
      ['turn', 'left', 'Oak Ave'],
      ['destination', undefined, undefined],
    ])
  })
})

const ZONE = 'America/New_York'
const T = (h: number, m = 0) => h * 3600 + m * 60
const delta = (times: number[]) => times.map((t, i) => (i ? t - times[i - 1] : t))

/** Two lines meeting at stop 1: the A from stop 0, the B on to stop 2; plus a weekend-only C straight through. */
const timetablePkg: TimetablePackage = {
  version: 1,
  bounds: [-1, -1, 1, 1],
  generatedAt: '',
  startDate: '20261123',
  days: 2,
  feeds: [{ id: 'f', timezone: ZONE }],
  stops: [
    { feed: 0, stopId: 's0', name: 'West', lng: 0, lat: 0 },
    { feed: 0, stopId: 's1', name: 'Middle', lng: D, lat: 0 },
    { feed: 0, stopId: 's2', name: 'East', lng: 2 * D, lat: 0 },
  ],
  routes: [
    { feed: 0, routeId: 'A', shortName: 'A', longName: '', type: 1, color: '0039A6' },
    { feed: 0, routeId: 'B', shortName: 'B', longName: '', type: 3 },
    { feed: 0, routeId: 'C', shortName: 'C', longName: '', type: 3 },
  ],
  patterns: [
    { route: 0, headsign: 'Middle', stops: [0, 1] },
    { route: 1, headsign: 'East', stops: [1, 2] },
    { route: 2, headsign: 'East', stops: [0, 2] },
  ],
  trips: [
    { pattern: 0, tripId: 'a1', days: 0b11, times: delta([T(9), T(9), T(9, 10), T(9, 10)]) },
    { pattern: 1, tripId: 'b1', days: 0b11, times: delta([T(9, 5), T(9, 5), T(9, 20), T(9, 20)]) },
    { pattern: 1, tripId: 'b2', days: 0b11, times: delta([T(9, 15), T(9, 15), T(9, 30), T(9, 30)]) },
    { pattern: 2, tripId: 'c1', days: 0b10, times: delta([T(9), T(9), T(9, 12), T(9, 12)]) },
  ],
  transfers: [],
}

describe('transit planning', () => {
  const tt = decodeTimetable(timetablePkg)
  const day0 = localMidnight('20261123', ZONE)

  it('reads local midnight in the feed time zone', () => {
    expect(new Date(day0 * 1000).toISOString()).toBe('2026-11-23T05:00:00.000Z')
  })

  it('changes lines at a shared stop, catching the first onward run after arriving', () => {
    const journey = planJourneys(tt, {
      access: new Map([[0, 0]]),
      egress: new Map([[2, 0]]),
      departAfter: day0 + T(8, 50),
    }).at(-1)!
    const rides = journey.legs.filter(l => l.kind === 'ride')
    expect(rides.map(r => tt.pkg.trips[r.run.trip].tripId)).toEqual(['a1', 'b2'])
    expect(journey.arrive).toBe(day0 + T(9, 30))
  })

  it('only runs trips on their service days', () => {
    const query = { access: new Map([[0, 0]]), egress: new Map([[2, 0]]) }
    const monday = planJourneys(tt, { ...query, departAfter: day0 + T(8, 50) })
    const tuesday = planJourneys(tt, { ...query, departAfter: day0 + 86_400 + T(8, 50) })
    expect(monday.at(-1)!.rides).toBe(2)
    expect(tuesday[0].rides).toBe(1)
    expect(tuesday[0].arrive).toBe(day0 + 86_400 + T(9, 12))
  })

  it('lists departures soonest first, skipping a line that ends here', () => {
    const board = departuresFrom(tt, 1, day0 + T(9), 2)
    expect(board.map(d => tt.pkg.trips[d.run.trip].tripId)).toEqual(['b1', 'b2'])
  })
})

describe('offline trips', () => {
  const graph = decodeStreetGraph(plus)
  // Stops a few kilometres apart, so riding beats walking.
  const timetable = decodeTimetable({
    ...timetablePkg,
    stops: timetablePkg.stops.map((s, i) => ({ ...s, lng: i * 0.05 })),
  })
  const region = { id: 'r', graph, timetable, stopNodes: stopNodesFor(graph, timetable) }

  it('plans a transit trip shaped like the online planner', () => {
    const response = planOfflineTrips([region], {
      origin: { lat: 0, lng: -0.0002 },
      destination: { lat: 0, lng: 0.1002 },
      selectedMode: 'transit',
      departAfter: (localMidnight('20261123', ZONE) + T(8, 55)) * 1000,
    })!
    const transit = response.trips.find(c => c.trip.segments.some(s => s.mode === 'transit'))!
    const ride = transit.trip.segments.find(s => s.mode === 'transit')!
    expect(ride.details!.transitDetails!.route).toMatchObject({ shortName: 'A', type: 'subway', color: '#0039A6' })
    expect(ride.geometry[0]).toEqual({ lat: 0, lng: 0 })
    expect(transit.trip.segments[0].start.type).toBe('origin')
    expect(transit.trip.segments.at(-1)!.end.type).toBe('destination')
  })

  it('finds nothing outside every saved area', () => {
    const far = { lat: 5, lng: 5 }
    expect(planOfflineTrips([region], { origin: far, destination: far, selectedMode: 'walking', departAfter: 0 })).toBeNull()
  })
})

describe('place index', () => {
  const place = (id: string, name: string, lng = 0) => ({ id, name, category: 'amenity/cafe', lng, lat: 0 })
  const index = buildPlaceIndex([
    place('node/1', 'Joe Coffee', 0.05),
    place('node/2', 'Joe Coffee', 0),
    place('node/3', 'Coffee Joe'),
    { ...place('way/4', 'Broadway', 0), category: 'highway/primary' },
    { ...place('way/5', 'Broadway', 0.001), category: 'highway/primary' },
  ])

  it('ranks the exact name first and the nearer of two equal names above the farther', () => {
    const hits = searchPlaceIndex(index, 'joe coff', { near: { lat: 0, lng: 0 } })
    expect(hits.map(h => h.place.id)).toEqual(['node/2', 'node/1', 'node/3'])
  })

  it('keeps one stretch of a street per neighbourhood', () => {
    expect(searchPlaceIndex(index, 'broadway').map(h => h.place.id)).toEqual(['way/4'])
  })
})
