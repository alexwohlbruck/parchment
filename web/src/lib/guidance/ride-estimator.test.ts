import { describe, expect, test } from 'vitest'
import { buildNavRoute, pointAt, stepIndexAt } from './nav-route'
import { rideStops, stageEvent, transitStage, type TransitEvent, type TransitSegmentInput } from './transit-progress'
import { estimatedPuck, RideEstimator } from './ride-estimator'
import { polyline } from './test-routes'

const walk = polyline([[0, 300]])
const ride = polyline([[90, 3000]], walk.at(-1))
const walkOff = polyline([[0, 200]], ride.at(-1))
const route = buildNavRoute([
  { mode: 'walking', geometry: walk },
  { mode: 'transit', geometry: ride },
  { mode: 'walking', geometry: walkOff },
])

const T0 = Date.parse('2026-10-29T12:00:00Z')
const HOP_MS = 120_000
const DWELL_MS = 30_000
const NAMES = ['Ash', 'Birch', 'Cedar', 'Dogwood', 'Elm', 'Fir']
const at = (k: number) => 300 + k * 600
const arrive = (k: number) => T0 + k * HOP_MS
const iso = (ms: number) => new Date(ms).toISOString()

const segment: TransitSegmentInput = {
  mode: 'transit',
  startTime: new Date(T0),
  departureStop: { name: NAMES[0], location: pointAt(route, at(0)), departureTime: iso(T0) },
  intermediateStops: NAMES.slice(1, -1).map((name, i) => ({
    name,
    location: pointAt(route, at(i + 1)),
    arrivalTime: iso(arrive(i + 1)),
    departureTime: iso(arrive(i + 1) + DWELL_MS),
  })),
  arrivalStop: { name: NAMES.at(-1)!, location: pointAt(route, at(5)), arrivalTime: iso(arrive(5)) },
}
const segments = [{ mode: 'walking' }, segment, { mode: 'walking' }]
const rides = segments.map((seg, i) => (seg.mode === 'transit' ? rideStops(route, i, seg) : null))
const stops = rides[1]!

interface Trip {
  /** When the vehicle actually reaches each stop and leaves it; leaving on arrival runs straight through. */
  times: { arrive: number; depart: number }[]
  /** GPS is available outside these spans. */
  outages: [from: number, to: number][]
  motion?: boolean
  realtime?: boolean
}

function truth(trip: Trip, t: number): { s: number; still: boolean } {
  const { times } = trip
  if (t <= times[0].depart) return { s: at(0), still: true }
  for (let k = 0; k < times.length - 1; k++) {
    if (t <= times[k].depart) return { s: at(k), still: times[k].depart > times[k].arrive }
    if (t < times[k + 1].arrive) {
      const f = (t - times[k].depart) / (times[k + 1].arrive - times[k].depart)
      return { s: at(k) + f * 600, still: false }
    }
  }
  return { s: at(5), still: true }
}

const onTime = (k: number) => ({ arrive: arrive(k), depart: k === 0 ? T0 : arrive(k) + DWELL_MS })

/** Ticks once a second from boarding, as the store does once a ride is underway. */
function replay(trip: Trip) {
  const boarded = trip.times[0].depart + 10_000
  const estimator = new RideEstimator(stops, { s: truth(trip, boarded).s, t: boarded }, { realtime: trip.realtime })
  const events = new Map<TransitEvent, number>()
  const countdown: { t: number; stopsLeft: number }[] = []
  const end = trip.times.at(-1)!.arrive + 20_000
  for (let t = boarded; t <= end; t += 1000) {
    const actual = truth(trip, t)
    const covered = trip.outages.some(([from, to]) => t >= from && t < to)
    const fix = covered ? null : { t, s: actual.s, accuracy: 5, offset: 0 }
    const estimate = estimator.update({ now: t, fix, still: trip.motion ? actual.still : null })
    const puck = estimatedPuck(
      { position: pointAt(route, actual.s), bearing: 90, s: actual.s, speed: 0, snapped: !covered, stepIndex: stepIndexAt(route, actual.s) },
      estimate,
    )
    const stage = transitStage(route, segments, rides, puck, t)
    if (stage?.kind === 'riding' && countdown.at(-1)?.stopsLeft !== stage.stopsLeft) countdown.push({ t, stopsLeft: stage.stopsLeft })
    const event = stage && stageEvent(stage)
    if (event && !events.has(event)) events.set(event, t)
  }
  return { events, countdown }
}

const UNDERGROUND: [number, number][] = [[T0 + 20_000, arrive(5) + 120_000]]
const stopsLeftAt = (countdown: { t: number; stopsLeft: number }[], t: number) => countdown.filter(c => c.t <= t).at(-1)?.stopsLeft

describe('RideEstimator', () => {
  test('counts the stops down through a tunnel on the timetable', () => {
    const times = NAMES.map((_, k) => onTime(k))
    const { events, countdown } = replay({ times, outages: UNDERGROUND, motion: true })
    expect(countdown.map(c => c.stopsLeft)).toEqual([5, 4, 3, 2, 1])
    countdown.slice(1).forEach((c, i) => expect(Math.abs(c.t - arrive(i + 1))).toBeLessThan(15_000))
    expect(events.get('alight-next')! - arrive(4)).toBeLessThan(15_000)
    expect(events.get('alight-now')).toBeGreaterThan(arrive(5) - 30_000)
    expect(events.get('alight-now')).toBeLessThanOrEqual(arrive(5))
    expect(events.has('missed-stop')).toBe(false)
  })

  test('carries a late departure’s delay underground, and dwells keep up as it grows', () => {
    const late = (k: number) => 90_000 + k * 20_000
    const times = NAMES.map((_, k) => ({ arrive: arrive(k) + late(k), depart: (k === 0 ? T0 : arrive(k) + DWELL_MS) + late(k) }))
    const { events, countdown } = replay({ times, outages: [[T0 + late(0) + 20_000, arrive(5) + late(5) + 60_000]], motion: true })
    expect(countdown.map(c => c.stopsLeft)).toEqual([5, 4, 3, 2, 1])
    countdown.slice(1).forEach((c, i) => expect(c.t).toBeGreaterThan(times[i + 1].arrive - 25_000))
    const alightNext = events.get('alight-next')!
    expect(alightNext - times[4].arrive).toBeLessThan(15_000)
    expect(events.get('alight-now')).toBeGreaterThan(times[5].arrive - 45_000)
    expect(events.get('alight-now')).toBeLessThanOrEqual(times[5].arrive)
    expect(events.has('missed-stop')).toBe(false)
  })

  test('an express running through a stop still lands on the right one, by its realtime timetable', () => {
    const early = (k: number) => (k >= 3 ? -DWELL_MS : 0)
    const times = NAMES.map((_, k) => ({ arrive: onTime(k).arrive + early(k), depart: onTime(k).depart + early(k) }))
    times[2] = { arrive: arrive(2), depart: arrive(2) }
    const { countdown } = replay({ times, outages: UNDERGROUND, motion: true, realtime: true })
    expect(countdown.map(c => c.stopsLeft)).toEqual([5, 4, 3, 2, 1])
    expect(stopsLeftAt(countdown, times[3].depart - 1000)).toBe(2)
    expect(stopsLeftAt(countdown, times[4].depart - 1000)).toBe(1)
  })

  test('without motion sensors the timetable alone carries it, then a fix on resurfacing corrects it', () => {
    const late = 150_000
    const times = NAMES.map((_, k) => (k === 0 ? onTime(0) : { arrive: arrive(k) + late, depart: arrive(k) + late + DWELL_MS }))
    times[0] = { arrive: T0, depart: T0 + late }
    const surface = arrive(3) + late + 60_000
    const estimator = new RideEstimator(stops, { s: at(0), t: T0 })
    const ahead = estimator.update({ now: surface - 1000, fix: null, still: null })
    expect(ahead.s).toBeGreaterThan(truth({ times, outages: [] }, surface).s + 600)
    expect(ahead.fresh).toBe(false)
    expect(ahead.confidence).toBeLessThan(0.5)
    const actual = truth({ times, outages: [] }, surface).s
    const fixed = estimator.update({ now: surface, fix: { t: surface, s: actual, accuracy: 8, offset: 3 }, still: null })
    expect(fixed).toMatchObject({ fresh: true, confidence: 1 })
    expect(fixed.s).toBeCloseTo(actual, 0)
    expect(estimator.update({ now: surface + 20_000, fix: null, still: null }).s).toBeLessThan(actual + 20_000 * (600 / 90_000) + 1)
  })

  test('a coarse network fix near a station snaps to it; stale and wild fixes are ignored', () => {
    const estimator = new RideEstimator(stops, { s: at(0), t: T0 })
    const now = arrive(3) + 10_000
    const before = estimator.update({ now: now - 1000, fix: null, still: null }).s
    expect(estimator.update({ now, fix: { t: now - 60_000, s: at(1), accuracy: 5, offset: 0 }, still: null }).s).toBeGreaterThanOrEqual(before)
    expect(estimator.update({ now, fix: { t: now, s: at(1), accuracy: 3000, offset: 0 }, still: null }).s).toBeGreaterThanOrEqual(before)
    const snapped = estimator.update({ now: now + 1000, fix: { t: now + 1000, s: at(2) + 120, accuracy: 300, offset: 150 }, still: null })
    expect(snapped.s).toBe(stops[2].s)
    expect(snapped.fresh).toBe(false)
  })

  test('never flags a missed stop while out of sight, though the last fix strayed off the line', () => {
    const estimator = new RideEstimator(stops, { s: at(0), t: T0 })
    const estimate = estimator.update({ now: arrive(5) - 60_000, fix: null, still: null })
    const strayed = { position: pointAt(route, at(4)), bearing: 90, s: at(4), speed: 0, snapped: false, stepIndex: 0 }
    expect(transitStage(route, segments, rides, strayed, arrive(5) - 60_000)?.kind).toBe('missed-stop')
    expect(transitStage(route, segments, rides, estimatedPuck(strayed, estimate), arrive(5) - 60_000)?.kind).toBe('riding')
  })

  test('the puck rests on the last stop reached rather than gliding between them', () => {
    const estimator = new RideEstimator(stops, { s: at(0), t: T0 })
    const midHop = estimator.update({ now: arrive(2) + DWELL_MS + 60_000, fix: null, still: null })
    expect(midHop.s).toBeGreaterThan(at(2) + 200)
    expect(midHop.shownS).toBe(stops[2].s)
  })
})
