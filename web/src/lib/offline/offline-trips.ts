/**
 * Trips planned on the device from saved region packages, shaped like the
 * server's planner response so Directions shows them unchanged.
 */
import { OFFLINE_SOURCE_ID } from '@/lib/offline/packages'
import {
  approxMeters,
  containsPoint,
  nearestNode,
  type StreetGraph,
  type StreetProfile,
} from './streets/street-graph'
import { pathManeuvers, pathPoints, shortestPath, STREET_SPEED, travelTimes, type StreetPath } from './streets/street-router'
import { arrivalAt, departureAt, timetableEnd, type Timetable } from './transit/timetable'
import { planJourneys, type Journey, type JourneyLeg } from './transit/raptor'
import type { Coordinate, RouteInstruction } from '@server/types/unified-routing.types'
import type {
  Mode,
  SelectedMode,
  TransitRouteType,
  TransitStop,
  TripCandidate,
  TripResponse,
  TripSegment,
} from '@server/types/trip.types'

export interface OfflineRegionData {
  id: string
  graph?: StreetGraph
  timetable?: Timetable
  /** Per timetable stop, its nearest walkable node in `graph`, or -1. */
  stopNodes?: Int32Array
}

export interface OfflineTripRequest {
  origin: Coordinate
  destination: Coordinate
  selectedMode: SelectedMode
  /** Epoch milliseconds. */
  departAfter: number
  requestId?: string
}

export interface OfflineTripResponse {
  trips: TripCandidate[]
  metadata: { totalCandidatesGenerated: number; processingTime: number; dataSourcesUsed: TripResponse['dataSources'] }
}

/** Walks to and from transit stop at this many seconds, like the online planner's default reach. */
const MAX_ACCESS_SECONDS = 15 * 60
/** Off-network walking, where no street joins the point, at a detour of a quarter on the straight line. */
const DETOUR = 1.25
const TRANSIT_OPTIONS = 3
const DATA_SOURCE = { id: OFFLINE_SOURCE_ID, name: 'Saved area', url: '', type: 'gtfs_static' as const }

const toCoordinate = ([lng, lat]: [number, number]): Coordinate => ({ lat, lng })
const iso = (epochSeconds: number) => new Date(epochSeconds * 1000).toISOString()

export function stopNodesFor(graph: StreetGraph, timetable: Timetable): Int32Array {
  return Int32Array.from(timetable.stops, s => nearestNode(graph, s.lng, s.lat, 'walking', 250) ?? -1)
}

/** The saved region covering both ends, preferring one with the data the mode needs. */
function regionFor(regions: OfflineRegionData[], a: Coordinate, b: Coordinate, transit: boolean) {
  const covers = (r: OfflineRegionData) => {
    const box = r.graph ?? (r.timetable && { bounds: r.timetable.pkg.bounds })
    if (!box) return false
    const inside = (c: Coordinate) => {
      const [w, s, e, n] = box.bounds
      return c.lng >= w && c.lng <= e && c.lat >= s && c.lat <= n
    }
    return inside(a) && inside(b)
  }
  const covering = regions.filter(covers)
  return (transit ? covering.find(r => r.timetable) : covering.find(r => r.graph)) ?? covering[0]
}

interface StreetLeg {
  points: [number, number][]
  distance: number
  duration: number
  instructions: RouteInstruction[]
}

/** A street route between two points, or a straight line where no street reaches them. */
function streetLeg(graph: StreetGraph | undefined, from: Coordinate, to: Coordinate, profile: StreetProfile): StreetLeg | null {
  const straight = (): StreetLeg => {
    const distance = approxMeters(from.lng, from.lat, to.lng, to.lat) * DETOUR
    return { points: [[from.lng, from.lat], [to.lng, to.lat]], distance, duration: distance / STREET_SPEED[profile], instructions: [] }
  }
  if (!graph || !containsPoint(graph, from.lng, from.lat)) return profile === 'walking' ? straight() : null
  const a = nearestNode(graph, from.lng, from.lat, profile)
  const b = nearestNode(graph, to.lng, to.lat, profile)
  if (a === null || b === null) return profile === 'walking' ? straight() : null
  const path = shortestPath(graph, a, b, profile)
  if (!path) return null
  return fromPath(graph, path, from, to, profile)
}

function fromPath(graph: StreetGraph, path: StreetPath, from: Coordinate, to: Coordinate, profile: StreetProfile): StreetLeg {
  const inner = pathPoints(graph, path)
  const points: [number, number][] = [[from.lng, from.lat], ...inner, [to.lng, to.lat]]
  const snap = inner.length
    ? approxMeters(from.lng, from.lat, inner[0][0], inner[0][1]) + approxMeters(to.lng, to.lat, inner.at(-1)![0], inner.at(-1)![1])
    : approxMeters(from.lng, from.lat, to.lng, to.lat)
  const distance = path.distance + snap
  const instructions = pathManeuvers(graph, path, profile).map(
    (m): RouteInstruction => ({
      type: m.type,
      text: '',
      coordinate: { lat: m.lat, lng: m.lng },
      distance: m.distance,
      duration: m.duration,
      modifier: m.modifier,
      streetName: m.streetName,
    }),
  )
  return { points, distance, duration: distance / STREET_SPEED[profile], instructions }
}

function streetSegment(leg: StreetLeg, mode: Mode, start: number, from: Coordinate, to: Coordinate): TripSegment {
  return {
    segmentIndex: 0,
    legIndex: 0,
    mode,
    start: { location: from, type: 'origin' },
    end: { location: to, type: 'destination' },
    startTime: iso(start),
    endTime: iso(start + leg.duration),
    duration: leg.duration,
    distance: leg.distance,
    geometry: leg.points.map(toCoordinate),
    instructions: leg.instructions,
  }
}

function candidate(segments: TripSegment[], requestId: string | undefined, transfers = 0): TripCandidate {
  segments.forEach((s, i) => (s.segmentIndex = i))
  const start = Date.parse(segments[0].startTime) / 1000
  const end = Date.parse(segments.at(-1)!.endTime) / 1000
  const trip: TripResponse = {
    segments,
    tripStats: {
      totalDuration: end - start,
      totalDistance: segments.reduce((sum, s) => sum + s.distance, 0),
      totalWalkingDistance: segments.filter(s => s.mode === 'walking').reduce((sum, s) => sum + s.distance, 0),
      totalTransfers: transfers,
    },
    earliestStartTime: iso(start),
    latestEndTime: iso(end),
    dataSources: [DATA_SOURCE],
    requestId,
    generatedAt: new Date().toISOString(),
  }
  return { trip, rank: 0, score: { overall: 0, time: 0, cost: 0, comfort: 0, environmental: 0, safety: 0 } }
}

export function gtfsRouteType(type: number): TransitRouteType {
  if (type === 0 || (type >= 900 && type < 1000)) return 'tram'
  if (type === 1 || (type >= 400 && type < 500)) return 'subway'
  if (type === 2 || (type >= 100 && type < 200)) return 'rail'
  if (type === 4 || type === 1000 || type === 1200) return 'ferry'
  if (type === 5) return 'cable_tram'
  if (type === 6 || (type >= 1300 && type < 1400)) return 'aerial_lift'
  if (type === 7 || type === 1400) return 'funicular'
  if (type === 11 || type === 800) return 'trolleybus'
  if (type === 12 || type === 405) return 'monorail'
  return 'bus'
}

const hex = (color?: string) => (color ? `#${color.replace(/^#/, '')}` : undefined)

function rideSegment(tt: Timetable, leg: Extract<JourneyLeg, { kind: 'ride' }>): TripSegment {
  const pattern = tt.pkg.patterns[leg.pattern]
  const route = tt.routes[pattern.route]
  const feed = tt.pkg.feeds[route.feed].id
  const positions = Array.from({ length: leg.to - leg.from + 1 }, (_, i) => leg.from + i)
  const stops: TransitStop[] = positions.map((position, i) => {
    const s = tt.stops[tt.patternStops[leg.pattern][position]]
    return {
      id: `${feed}_${s.stopId}`,
      name: s.name,
      location: { lat: s.lat, lng: s.lng },
      arrivalTime: iso(arrivalAt(tt, leg.run, position)),
      departureTime: iso(departureAt(tt, leg.run, position)),
      stopSequence: i,
    }
  })
  const geometry = stops.map(s => s.location)
  const distance = geometry.slice(1).reduce((sum, c, i) => sum + approxMeters(geometry[i].lng, geometry[i].lat, c.lng, c.lat), 0)
  const color = hex(route.color)
  const textColor = hex(route.textColor)
  const [departureStop, arrivalStop] = [stops[0], stops.at(-1)!]
  return {
    segmentIndex: 0,
    legIndex: 0,
    mode: 'transit',
    start: { location: departureStop.location, type: 'via', label: departureStop.name },
    end: { location: arrivalStop.location, type: 'via', label: arrivalStop.name },
    startTime: iso(leg.depart),
    endTime: iso(leg.arrive),
    duration: leg.arrive - leg.depart,
    distance,
    geometry,
    instructions: [],
    details: {
      transitDetails: {
        route: {
          id: route.routeId,
          shortName: route.shortName || undefined,
          longName: route.longName || undefined,
          type: gtfsRouteType(route.type),
          color,
          textColor,
          agency: { id: feed, name: route.agency ?? '' },
        },
        trip: { id: tt.pkg.trips[leg.run.trip].tripId, headsign: pattern.headsign },
        stops,
        departureStop,
        arrivalStop,
        headsign: pattern.headsign,
        shortName: route.shortName || undefined,
        color,
        textColor,
        directionId: pattern.directionId === undefined ? undefined : String(pattern.directionId),
      },
    },
  }
}

function stopPoint(tt: Timetable, stop: number): Coordinate {
  return { lat: tt.stops[stop].lat, lng: tt.stops[stop].lng }
}

function journeySegments(region: OfflineRegionData, journey: Journey, from: Coordinate, to: Coordinate): TripSegment[] {
  const tt = region.timetable!
  const segments: TripSegment[] = []
  const walk = (a: Coordinate, b: Coordinate, start: number, end: number) => {
    const leg = streetLeg(region.graph, a, b, 'walking')!
    if (leg.distance < 5) return
    const segment = streetSegment(leg, 'walking', start, a, b)
    // The timetable sets when the walk must end; any slack is waiting at the stop.
    segment.waitSeconds = Math.max(0, end - start - leg.duration)
    segment.endTime = iso(end)
    segment.duration = end - start
    segments.push(segment)
  }
  for (const leg of journey.legs) {
    if (leg.kind === 'access') walk(from, stopPoint(tt, leg.stop), leg.depart, leg.arrive)
    else if (leg.kind === 'egress') walk(stopPoint(tt, leg.stop), to, leg.depart, leg.arrive)
    else if (leg.kind === 'transfer') walk(stopPoint(tt, leg.from), stopPoint(tt, leg.to), leg.depart, leg.arrive)
    else segments.push(rideSegment(tt, leg))
  }
  // A walk to a stop that is then left on foot again is one walk.
  for (let i = segments.length - 1; i > 0; i--) {
    const [a, b] = [segments[i - 1], segments[i]]
    if (a.mode !== 'walking' || b.mode !== 'walking') continue
    const start = Date.parse(a.startTime) / 1000
    const end = Date.parse(b.endTime) / 1000
    const merged = streetSegment(streetLeg(region.graph, a.start.location, b.end.location, 'walking')!, 'walking', start, a.start.location, b.end.location)
    merged.waitSeconds = Math.max(0, end - start - merged.duration)
    merged.endTime = iso(end)
    merged.duration = end - start
    segments.splice(i - 1, 2, merged)
  }
  // A transfer's walk ends at the next boarding, not at its own arrival.
  for (let i = 0; i < segments.length - 1; i++) {
    const next = Date.parse(segments[i + 1].startTime) / 1000
    const end = Date.parse(segments[i].endTime) / 1000
    if (segments[i].mode === 'walking' && next > end) {
      segments[i].waitSeconds = (segments[i].waitSeconds ?? 0) + next - end
      segments[i].duration += next - end
      segments[i].endTime = iso(next)
    }
  }
  segments[0].start.type = 'origin'
  segments.at(-1)!.end.type = 'destination'
  return segments
}

/** Seconds of walking between a point and every stop within reach. */
function stopsInReach(region: OfflineRegionData, point: Coordinate): Map<number, number> {
  const tt = region.timetable!
  const reach = new Map<number, number>()
  const { graph, stopNodes } = region
  const node = graph && containsPoint(graph, point.lng, point.lat) ? nearestNode(graph, point.lng, point.lat, 'walking') : null
  if (graph && stopNodes && node !== null) {
    const snap = approxMeters(point.lng, point.lat, graph.nodeLng[node], graph.nodeLat[node]) / STREET_SPEED.walking
    const times = travelTimes(graph, node, 'walking', MAX_ACCESS_SECONDS)
    stopNodes.forEach((n, stop) => {
      const t = n >= 0 ? times.get(n) : undefined
      if (t === undefined) return
      const stopSnap = approxMeters(tt.stops[stop].lng, tt.stops[stop].lat, graph.nodeLng[n], graph.nodeLat[n]) / STREET_SPEED.walking
      reach.set(stop, t + snap + stopSnap)
    })
    if (reach.size) return reach
  }
  tt.stops.forEach((s, stop) => {
    const seconds = (approxMeters(point.lng, point.lat, s.lng, s.lat) * DETOUR) / STREET_SPEED.walking
    if (seconds <= MAX_ACCESS_SECONDS) reach.set(stop, seconds)
  })
  return reach
}

function transitCandidates(region: OfflineRegionData, request: OfflineTripRequest): TripCandidate[] {
  const tt = region.timetable!
  const departAfter = Math.floor(request.departAfter / 1000)
  if (departAfter >= timetableEnd(tt)) return []
  const access = stopsInReach(region, request.origin)
  const egress = stopsInReach(region, request.destination)
  if (!access.size || !egress.size) return []

  const found: Journey[] = []
  let after = departAfter
  for (let option = 0; option < TRANSIT_OPTIONS; option++) {
    const journeys = planJourneys(tt, { access, egress, departAfter: after })
    // Of the rides-versus-time trade-offs, take the fastest one that isn't a minute-saving extra change.
    const pick = journeys.reduce<Journey | undefined>(
      (best, j) => (!best || j.arrive < best.arrive - 5 * 60 * (j.rides - best.rides) ? j : best),
      undefined,
    )
    if (!pick) break
    const firstRide = pick.legs.find(l => l.kind === 'ride')!
    if (!found.some(j => j.legs.find(l => l.kind === 'ride')?.depart === firstRide.depart)) found.push(pick)
    after = firstRide.depart - (pick.legs[0].kind === 'access' ? pick.legs[0].seconds : 0) + 60
  }
  // Leaving earlier only to arrive at the same time is never the better trip.
  const worthTaking = found.filter(j => !found.some(o => o !== j && o.arrive <= j.arrive && o.depart > j.depart))
  return worthTaking.map(j =>
    candidate(journeySegments(region, j, request.origin, request.destination), request.requestId, Math.max(0, j.rides - 1)),
  )
}

const WALK_LIMIT_METRES = 8000

export function planOfflineTrips(regions: OfflineRegionData[], request: OfflineTripRequest): OfflineTripResponse | null {
  const started = performance.now()
  const { origin, destination, selectedMode } = request
  const wantTransit = selectedMode === 'transit' || selectedMode === 'multi'
  const region = regionFor(regions, origin, destination, wantTransit)
  if (!region) return null
  const start = request.departAfter / 1000
  const trips: TripCandidate[] = []

  if (wantTransit && region.timetable) trips.push(...transitCandidates(region, request))

  const straight = approxMeters(origin.lng, origin.lat, destination.lng, destination.lat)
  if (selectedMode === 'walking' || (selectedMode === 'multi' && straight < WALK_LIMIT_METRES) || (selectedMode === 'transit' && !trips.length)) {
    const walk = streetLeg(region.graph, origin, destination, 'walking')
    if (walk) trips.push(candidate([streetSegment(walk, 'walking', start, origin, destination)], request.requestId))
  }
  if ((selectedMode === 'biking' || selectedMode === 'multi') && region.graph) {
    const ride = streetLeg(region.graph, origin, destination, 'cycling')
    if (ride) trips.push(candidate([streetSegment(ride, 'biking', start, origin, destination)], request.requestId))
  }

  trips.sort((a, b) => Date.parse(a.trip.latestEndTime) - Date.parse(b.trip.latestEndTime))
  trips.forEach((t, i) => {
    t.rank = i + 1
    t.score.overall = t.score.time = 1 / (i + 1)
  })
  return {
    trips,
    metadata: { totalCandidatesGenerated: trips.length, processingTime: performance.now() - started, dataSourcesUsed: [DATA_SOURCE] },
  }
}
