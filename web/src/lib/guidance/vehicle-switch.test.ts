import { describe, expect, test } from 'vitest'
import { buildNavRoute, pointAt } from './nav-route'
import { rideStops, type TransitSegmentInput } from './transit-progress'
import { polyline } from './test-routes'
import {
  rankCandidates,
  retargetedRide,
  RideObserver,
  vehicleVerdict,
  type CandidateSet,
  type RideEvidence,
  type VehicleCandidate,
} from './vehicle-switch'

const T = Date.parse('2026-10-29T12:00:00Z')
const min = (n: number) => T + n * 60_000

const walk = polyline([[0, 300]])
const ride = polyline([[90, 3000]], walk.at(-1))
const route = buildNavRoute([
  { mode: 'walking', geometry: walk },
  { mode: 'transit', geometry: ride },
])
const segment: TransitSegmentInput & { tripId: string; lineName: string; duration: number } = {
  mode: 'transit',
  tripId: 'planned',
  lineName: '3',
  startTime: new Date(min(0)),
  endTime: new Date(min(8)),
  duration: 480,
  departureStop: { id: 'S0', name: 'Board', location: ride[0] },
  intermediateStops: [
    { id: 'S1', name: 'First', location: pointAt(route, 1000), arrivalTime: new Date(min(2)).toISOString() },
    { id: 'S2', name: 'Second', location: pointAt(route, 1800), arrivalTime: new Date(min(4)).toISOString() },
    { id: 'S3', name: 'Third', location: pointAt(route, 2600), arrivalTime: new Date(min(6)).toISOString() },
  ],
  arrivalStop: { id: 'S4', name: 'Alight', location: ride.at(-1), arrivalTime: new Date(min(8)).toISOString() },
}
const stops = rideStops(route, 1, segment)
const KNOWN = ['S1', 'S2', 'S3', 'S4']

/** A run leaving `dep` minutes past the hour; a local calls everywhere two minutes apart. */
function run(tripId: string, line: string, dep: number, pattern: 'local' | 'express' = 'local'): VehicleCandidate {
  const calls = pattern === 'local'
    ? KNOWN.map((stop, i) => ({ stop, timeMs: min(dep + 2 * (i + 1)) }))
    : [{ stop: 'S2', timeMs: min(dep + 3) }, { stop: 'S4', timeMs: min(dep + 6) }]
  return { tripId, line, departureMs: min(dep), calls }
}

const evidence = (partial: Partial<RideEvidence>): RideEvidence => ({
  boardedAtMs: null, stops: [], divergedBefore: null, position: null, positionMs: null, ...partial,
})

function decide(candidates: VehicleCandidate[], seen: Partial<RideEvidence>) {
  const set: CandidateSet = { candidates, known: KNOWN }
  return vehicleVerdict(rankCandidates(set, evidence(seen), 'planned', min(10)))
}

describe('vehicleVerdict', () => {
  test('an earlier run of the planned line is taken outright', () => {
    const verdict = decide([run('earlier', '3', -4), run('planned', '3', 0)], { boardedAtMs: min(-4) + 10_000 })
    expect(verdict).toMatchObject({ kind: 'settled', candidate: { tripId: 'earlier' } })
  })

  test('a later run of the planned line is taken outright', () => {
    const verdict = decide([run('planned', '3', 0), run('later', '3', 6), run('last', '3', 12)], { boardedAtMs: min(6) + 20_000 })
    expect(verdict).toMatchObject({ kind: 'settled', candidate: { tripId: 'later' } })
  })

  test('the planned run boarded on time stays', () => {
    const verdict = decide([run('earlier', '3', -5), run('planned', '3', 0), run('later', '3', 5)], { boardedAtMs: min(0) + 15_000 })
    expect(verdict).toMatchObject({ kind: 'settled', candidate: { tripId: 'planned' } })
  })

  test('an interchangeable line leaving when the rider did is taken', () => {
    const verdict = decide([run('planned', '3', 0), run('two', '2', 3)], { boardedAtMs: min(3) })
    expect(verdict).toMatchObject({ kind: 'settled', candidate: { tripId: 'two', line: '2' } })
  })

  test('two lines leaving together are asked about, likeliest first', () => {
    const verdict = decide([run('planned', '3', 0), run('two', '2', 0.5), run('far', '3', 9)], { boardedAtMs: min(0.3) })
    expect(verdict.kind).toBe('ask')
    if (verdict.kind !== 'ask') return
    expect(verdict.options.map(o => o.candidate.tripId)).toEqual(['planned', 'two'])
  })

  test('a dwell at a stop the express skips settles on the local', () => {
    const candidates = [run('planned', '3', 0, 'express'), run('two', '2', 0.5)]
    expect(decide(candidates, { boardedAtMs: min(0.3) }).kind).toBe('ask')
    const verdict = decide(candidates, { boardedAtMs: min(0.3), stops: [{ stop: 'S1', atMs: min(2.5), dwelled: true }] })
    expect(verdict).toMatchObject({ kind: 'settled', candidate: { tripId: 'two' } })
  })

  test('running straight through stops settles on the express', () => {
    const candidates = [run('planned', '3', 0, 'express'), run('two', '2', 0.5)]
    const verdict = decide(candidates, {
      boardedAtMs: min(0.3),
      stops: [{ stop: 'S1', atMs: min(1.5), dwelled: false }, { stop: 'S2', atMs: min(3), dwelled: true }],
    })
    expect(verdict).toMatchObject({ kind: 'settled', candidate: { tripId: 'planned' } })
  })

  test('a live vehicle far from the rider is ruled out', () => {
    const here = pointAt(route, 1500)
    const far = { ...pointAt(route, 0), atMs: min(10) }
    const verdict = decide(
      [{ ...run('planned', '3', 0), position: far }, run('two', '2', 0.5)],
      { boardedAtMs: min(0.3), position: here, positionMs: min(10) },
    )
    expect(verdict).toMatchObject({ kind: 'settled', candidate: { tripId: 'two' } })
  })

  test('leaving the planned path rules out runs that follow it', () => {
    const candidates = [run('planned', '3', 0), run('two', '2', 0.5, 'express')]
    const verdict = decide(candidates, { boardedAtMs: min(0.3), divergedBefore: 'S1' })
    expect(verdict).toMatchObject({ kind: 'settled', candidate: { tripId: 'two' } })
  })

  test('nothing to go on keeps the plan', () => {
    expect(decide([], { boardedAtMs: min(0) })).toEqual({ kind: 'unknown' })
  })
})

describe('RideObserver', () => {
  test('reads the boarding moment and each stop as dwelled or passed', () => {
    const observer = new RideObserver(stops)
    let now = min(-1)
    const at = (s: number, speed: number) => observer.update({ s, speed, snapped: true, position: pointAt(route, s), nowMs: now })
    for (; now < min(1); now += 1000) at(300, 0)
    let s = 300
    const travel = (to: number) => {
      for (; s < to; s += 10, now += 1000) at(s, 10)
    }
    travel(1000)
    for (let i = 0; i < 15; i++, now += 1000) at(1000, 0)
    travel(2700)
    const seen = observer.evidence()
    expect(Math.abs(seen.boardedAtMs! - min(1))).toBeLessThan(5000)
    expect(seen.stops.map(o => [o.stop, o.dwelled])).toEqual([['S1', true], ['S2', false], ['S3', false]])
  })

  test('marks where the rider left the planned path', () => {
    const observer = new RideObserver(stops)
    let now = min(0)
    observer.update({ s: 300, speed: 0, snapped: true, position: pointAt(route, 300), nowMs: now })
    observer.update({ s: 400, speed: 10, snapped: true, position: pointAt(route, 400), nowMs: (now += 10_000) })
    for (let i = 0; i < 40; i++) observer.update({ s: 400, speed: 10, snapped: false, position: pointAt(route, 400), nowMs: (now += 1000) })
    expect(observer.evidence().divergedBefore).toBe('S1')
  })
})

describe('retargetedRide', () => {
  test('takes the run, its times and only the stops it calls at', () => {
    const next = retargetedRide(segment, { ...run('two', '2', 3, 'express'), color: '00933C' }, KNOWN)
    expect(next).toMatchObject({ tripId: 'two', lineName: '2', lineColor: '00933C', duration: 360 })
    expect(new Date(next.startTime!).getTime()).toBe(min(3))
    expect(new Date(next.endTime!).getTime()).toBe(min(9))
    expect(next.intermediateStops?.map(s => s.name)).toEqual(['Second'])
    expect(next.arrivalStop?.arrivalTime).toBe(new Date(min(9)).toISOString())
  })

  test('shifts stops it knows nothing about with the departure', () => {
    const next = retargetedRide(segment, { tripId: 'later', line: '3', departureMs: min(5), calls: [] }, [])
    expect(next.intermediateStops?.map(s => s.arrivalTime)).toEqual([min(7), min(9), min(11)].map(t => new Date(t).toISOString()))
    expect(new Date(next.endTime!).getTime()).toBe(min(13))
  })
})
