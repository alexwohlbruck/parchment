import { approxMeters } from '@/lib/offline/streets/street-graph'
import type { TimetablePackage, TimetableRoute, TimetableStop } from '@/types/offline-package.types'

const DAY = 86_400

export interface Timetable {
  pkg: TimetablePackage
  stops: TimetableStop[]
  routes: TimetableRoute[]
  /** Per pattern, its stop indexes. */
  patternStops: Int32Array[]
  /** Per trip, arrival and departure at each pattern stop, in GTFS seconds. */
  tripTimes: Int32Array[]
  tripsByPattern: number[][]
  /** Per stop, `[pattern, position]` pairs. */
  stopPatterns: [number, number][][]
  /** Per stop, `[stop, seconds]` walking transfers, both directions. */
  transfers: [number, number][][]
  /** Per station, its platforms; per platform, its station. */
  children: number[][]
  /** Epoch seconds of each feed's service-day midnight, for day 0 of the package. */
  dayZero: number[]
}

/** Epoch seconds of local midnight on `yyyymmdd` in `timeZone`. */
export function localMidnight(yyyymmdd: string, timeZone: string): number {
  const y = Number(yyyymmdd.slice(0, 4))
  const m = Number(yyyymmdd.slice(4, 6)) - 1
  const d = Number(yyyymmdd.slice(6, 8))
  const guess = Date.UTC(y, m, d) / 1000
  return guess - zoneOffset(guess, timeZone)
}

/** Seconds `timeZone` is ahead of UTC at `epoch`. */
function zoneOffset(epoch: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(new Date(epoch * 1000))
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value)
  const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) / 1000
  return local - epoch
}

export function decodeTimetable(pkg: TimetablePackage): Timetable {
  const patternStops = pkg.patterns.map(p => Int32Array.from(p.stops))
  const tripsByPattern: number[][] = pkg.patterns.map(() => [])
  const tripTimes = pkg.trips.map((trip, i) => {
    const times = new Int32Array(trip.times.length)
    let t = 0
    for (let k = 0; k < times.length; k++) times[k] = t += trip.times[k]
    tripsByPattern[trip.pattern].push(i)
    return times
  })
  const stopPatterns: [number, number][][] = pkg.stops.map(() => [])
  patternStops.forEach((stops, p) => stops.forEach((s, i) => stopPatterns[s].push([p, i])))

  const transfers: [number, number][][] = pkg.stops.map(() => [])
  const seen = new Set<string>()
  const addTransfer = (a: number, b: number, seconds: number) => {
    if (a === b || seen.has(`${a}:${b}`)) return
    seen.add(`${a}:${b}`)
    transfers[a].push([b, seconds])
  }
  for (const [a, b, seconds] of pkg.transfers) {
    addTransfer(a, b, seconds)
    addTransfer(b, a, seconds)
  }

  const children: number[][] = pkg.stops.map(() => [])
  pkg.stops.forEach((s, i) => {
    if (s.parent !== undefined) children[s.parent].push(i)
  })
  // Platforms of one station connect even where the feed lists no transfer.
  const STATION_TRANSFER_SECONDS = 120
  for (const platforms of children) {
    for (const a of platforms) for (const b of platforms) addTransfer(a, b, STATION_TRANSFER_SECONDS)
  }
  addNearbyTransfers(pkg.stops, addTransfer)

  return {
    pkg,
    stops: pkg.stops,
    routes: pkg.routes,
    patternStops,
    tripTimes,
    tripsByPattern,
    stopPatterns,
    transfers,
    children,
    dayZero: pkg.feeds.map(f => localMidnight(pkg.startDate, f.timezone)),
  }
}

/** Feeds only list transfers among their own stops, so a bus to a subway needs one by distance. */
const NEARBY_TRANSFER_METRES = 250
const WALK_METRES_PER_SECOND = 1.2

function addNearbyTransfers(stops: TimetableStop[], add: (a: number, b: number, seconds: number) => void) {
  const cell = NEARBY_TRANSFER_METRES / 111_195
  const grid = new Map<string, number[]>()
  const key = (x: number, y: number) => `${x}:${y}`
  stops.forEach((s, i) => {
    const k = key(Math.floor(s.lng / cell), Math.floor(s.lat / cell))
    grid.get(k)?.push(i) ?? grid.set(k, [i])
  })
  stops.forEach((s, a) => {
    const x = Math.floor(s.lng / cell)
    const y = Math.floor(s.lat / cell)
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const b of grid.get(key(x + dx, y + dy)) ?? []) {
          if (stops[b].feed === s.feed) continue
          const metres = approxMeters(s.lng, s.lat, stops[b].lng, stops[b].lat)
          if (metres <= NEARBY_TRANSFER_METRES) add(a, b, Math.round((metres * 1.3) / WALK_METRES_PER_SECOND) + 60)
        }
      }
    }
  })
}

/** Epoch seconds when the package's last service day ends. */
export function timetableEnd(tt: Timetable): number {
  return Math.min(...tt.dayZero) + tt.pkg.days * DAY
}

export interface ServiceRun {
  trip: number
  /** Epoch seconds the trip's GTFS times count from. */
  base: number
}

/**
 * Every run of a pattern that may be under way around `epoch`: trips on the
 * service day containing it and on the day before (late-night trips run past
 * midnight), sorted by departure from the pattern's first stop.
 */
export function runsAround(tt: Timetable, pattern: number, epoch: number): ServiceRun[] {
  const feed = tt.routes[tt.pkg.patterns[pattern].route].feed
  const today = Math.floor((epoch - tt.dayZero[feed]) / DAY)
  const runs: ServiceRun[] = []
  for (const day of [today - 1, today, today + 1]) {
    if (day < 0 || day >= tt.pkg.days) continue
    const base = tt.dayZero[feed] + day * DAY
    for (const trip of tt.tripsByPattern[pattern]) {
      if (tt.pkg.trips[trip].days & (1 << day)) runs.push({ trip, base })
    }
  }
  return runs.sort((a, b) => a.base + tt.tripTimes[a.trip][1] - (b.base + tt.tripTimes[b.trip][1]))
}

export const arrivalAt = (tt: Timetable, run: ServiceRun, position: number) =>
  run.base + tt.tripTimes[run.trip][position * 2]

export const departureAt = (tt: Timetable, run: ServiceRun, position: number) =>
  run.base + tt.tripTimes[run.trip][position * 2 + 1]

export interface ScheduledDeparture {
  stop: number
  pattern: number
  run: ServiceRun
  position: number
  /** Epoch seconds. */
  departure: number
}

/** The next departures from a stop or any of its platforms, soonest first. */
export function departuresFrom(tt: Timetable, stop: number, after: number, limit: number): ScheduledDeparture[] {
  const out: ScheduledDeparture[] = []
  for (const s of [stop, ...tt.children[stop]]) {
    for (const [pattern, position] of tt.stopPatterns[s]) {
      if (position === tt.patternStops[pattern].length - 1) continue
      for (const run of runsAround(tt, pattern, after)) {
        const departure = departureAt(tt, run, position)
        if (departure >= after) out.push({ stop: s, pattern, run, position, departure })
      }
    }
  }
  return out.sort((a, b) => a.departure - b.departure).slice(0, limit)
}
