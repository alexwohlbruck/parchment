/**
 * The runs a rider could have boarded instead of the planned one: any run of
 * the leg's interchangeable routes leaving the boarding stop around the
 * planned time, and runs of other routes that also reach the alighting stop.
 */

export interface BoardDeparture {
  tripId: string
  route: {
    id: string
    feedId?: string
    shortName?: string
    longName?: string
    type?: number
    color?: string
    textColor?: string
  }
  headsign?: string
  directionId?: string
  departureTime: string
  arrivalTime?: string
  scheduledDepartureTime?: string
  realTime?: boolean
  cancelled?: boolean
}

export interface Board {
  departures?: BoardDeparture[]
}

export interface CandidateCall {
  stopId: string
  time: string
}

export interface LivePosition {
  lat: number
  lng: number
  at: string
}

export interface BoardingCandidate {
  tripId: string
  route: BoardDeparture['route']
  headsign?: string
  directionId?: string
  departureTime: string
  scheduledDepartureTime?: string
  realTime: boolean
  /** The leg's later stops this run calls at, with its time there. */
  calls: CandidateCall[]
  position?: LivePosition
}

export interface BoardingCandidates {
  candidates: BoardingCandidate[]
  /** The later stops whose boards were read in full; a run absent from one of them does not call there. */
  stops: string[]
}

export interface LiveVehicle {
  tripId?: string
  position: { lat: number; lng: number }
  timestamp: string
}

export const EARLY_MINUTES = 10
export const LATE_MINUTES = 20
export const MAX_CANDIDATES = 8

const departuresOf = (boards: Board[]) => boards.flatMap((b) => b.departures ?? [])
const timeOf = (d: BoardDeparture) => Date.parse(d.arrivalTime || d.departureTime)

export function boardingCandidates(input: {
  board: Board[]
  /** The leg's stops after boarding, in ride order; the last is where the rider gets off. */
  later: { stopId: string; boards: Board[] }[]
  plannedMs: number
  /** Short names of the leg's interchangeable routes, its own included. */
  routes: string[]
  directionId?: string
}): BoardingCandidate[] {
  const from = input.plannedMs - EARLY_MINUTES * 60_000
  const to = input.plannedMs + LATE_MINUTES * 60_000
  const routes = new Set(input.routes)
  const alightId = input.later.at(-1)?.stopId
  const callsByTrip = new Map<string, Map<string, number>>()
  for (const stop of input.later) {
    for (const d of departuresOf(stop.boards)) {
      if (d.cancelled) continue
      const calls = callsByTrip.get(d.tripId) ?? new Map<string, number>()
      if (!calls.has(stop.stopId)) calls.set(stop.stopId, timeOf(d))
      callsByTrip.set(d.tripId, calls)
    }
  }

  const seen = new Set<string>()
  const out: BoardingCandidate[] = []
  for (const d of departuresOf(input.board)) {
    const at = Date.parse(d.departureTime)
    if (d.cancelled || seen.has(d.tripId) || Number.isNaN(at) || at < from || at > to) continue
    seen.add(d.tripId)
    const known = callsByTrip.get(d.tripId)
    const calls = input.later.flatMap((stop) => {
      const time = known?.get(stop.stopId)
      return time != null && time > at ? [{ stopId: stop.stopId, time: new Date(time).toISOString() }] : []
    })
    const sameDirection = input.directionId == null || d.directionId == null || String(d.directionId) === String(input.directionId)
    const interchangeable = !!d.route.shortName && routes.has(d.route.shortName) && sameDirection
    const reachesAlight = calls.some((c) => c.stopId === alightId)
    if (!interchangeable && !reachesAlight) continue
    out.push({
      tripId: d.tripId,
      route: d.route,
      headsign: d.headsign,
      directionId: d.directionId,
      departureTime: d.departureTime,
      scheduledDepartureTime: d.scheduledDepartureTime,
      realTime: !!d.realTime,
      calls,
    })
  }
  return out
    .sort((a, b) => Math.abs(Date.parse(a.departureTime) - input.plannedMs) - Math.abs(Date.parse(b.departureTime) - input.plannedMs))
    .slice(0, MAX_CANDIDATES)
    .sort((a, b) => Date.parse(a.departureTime) - Date.parse(b.departureTime))
}

/** A timetable run id (`{date}_{time}_{feed}_{trip}`) and a realtime vehicle's (`{feed}_{trip}`) name the same run. */
export function sameRun(timetableTripId: string, vehicleTripId: string): boolean {
  return timetableTripId === vehicleTripId || timetableTripId.endsWith(`_${vehicleTripId}`)
}

export function withPositions(candidates: BoardingCandidate[], vehicles: LiveVehicle[]): BoardingCandidate[] {
  return candidates.map((candidate) => {
    const vehicle = vehicles.find((v) => v.tripId && sameRun(candidate.tripId, v.tripId))
    return vehicle ? { ...candidate, position: { ...vehicle.position, at: vehicle.timestamp } } : candidate
  })
}

/** At most `max` of the leg's later stops: always the alighting stop, the rest spread evenly. */
export function sampleStops<T>(stops: T[], max: number): T[] {
  if (stops.length <= max) return stops
  const picked = Array.from({ length: max - 1 }, (_, i) => stops[Math.floor((i * (stops.length - 1)) / (max - 1))])
  return [...picked, stops[stops.length - 1]]
}
