import { describe, test, expect } from 'bun:test'
import { boardingCandidates, sameRun, sampleStops, withPositions, type BoardDeparture } from './boarding-candidates'

const T = Date.parse('2026-10-15T19:00:00Z')
const at = (min: number) => new Date(T + min * 60_000).toISOString()
const run = (tripId: string, shortName: string, min: number, directionId = '0'): BoardDeparture => ({
  tripId,
  route: { id: shortName, shortName },
  directionId,
  departureTime: at(min),
})

const later = (calls: Record<string, [string, number][]>) =>
  Object.entries(calls).map(([stopId, runs]) => ({
    stopId,
    boards: [{ departures: runs.map(([tripId, min]) => run(tripId, '?', min)) }],
  }))

describe('boardingCandidates', () => {
  test('keeps interchangeable runs inside the window, in departure order', () => {
    const board = [{ departures: [run('t-early', '3', -12), run('t1', '3', -4), run('t2', '2', 1), run('t3', '3', 0), run('t-late', '3', 25)] }]
    const out = boardingCandidates({ board, later: later({ B: [] }), plannedMs: T, routes: ['2', '3'] })
    expect(out.map((c) => c.tripId)).toEqual(['t1', 't3', 't2'])
  })

  test('drops interchangeable runs heading the other way', () => {
    const board = [{ departures: [run('t1', '3', 0), run('t2', '3', 2, '1')] }]
    const out = boardingCandidates({ board, later: later({ B: [] }), plannedMs: T, routes: ['3'], directionId: '0' })
    expect(out.map((c) => c.tripId)).toEqual(['t1'])
  })

  test('adds another route only when it reaches the alighting stop', () => {
    const board = [{ departures: [run('t1', '3', 0), run('bus', 'B44', 2), run('other', 'Q', 3)] }]
    const out = boardingCandidates({
      board,
      later: later({ MID: [['other', 6]], ALIGHT: [['bus', 12], ['t1', 10]] }),
      plannedMs: T,
      routes: ['3'],
    })
    expect(out.map((c) => c.tripId)).toEqual(['t1', 'bus'])
  })

  test('lists the later stops each run calls at, so an express can be told from a local', () => {
    const board = [{ departures: [run('local', '1', 0), run('express', '2', 1)] }]
    const out = boardingCandidates({
      board,
      later: later({ A: [['local', 2]], B: [['local', 4], ['express', 3]], C: [['local', 6], ['express', 5]] }),
      plannedMs: T,
      routes: ['1', '2'],
    })
    expect(out.find((c) => c.tripId === 'local')!.calls.map((c) => c.stopId)).toEqual(['A', 'B', 'C'])
    expect(out.find((c) => c.tripId === 'express')!.calls).toEqual([
      { stopId: 'B', time: at(3) },
      { stopId: 'C', time: at(5) },
    ])
  })

  test('ignores a call timed before the run leaves, which is another day or direction', () => {
    const board = [{ departures: [run('t1', '3', 0)] }]
    const out = boardingCandidates({ board, later: later({ B: [['t1', -5]] }), plannedMs: T, routes: ['3'] })
    expect(out[0].calls).toEqual([])
  })
})

describe('positions', () => {
  test('matches a vehicle by the trip id inside the timetable id', () => {
    expect(sameRun('20261015_19:00_5_A123', '5_A123')).toBe(true)
    expect(sameRun('20261015_19:00_5_A123', '5_A12')).toBe(false)
  })

  test('attaches the live position of the matching run', () => {
    const [candidate] = boardingCandidates({ board: [{ departures: [run('20261015_19:00_5_A1', '3', 0)] }], later: [], plannedMs: T, routes: ['3'] })
    const [placed] = withPositions([candidate], [{ tripId: '5_A1', position: { lat: 1, lng: 2 }, timestamp: at(1) }])
    expect(placed.position).toEqual({ lat: 1, lng: 2, at: at(1) })
  })
})

describe('sampleStops', () => {
  test('always keeps the alighting stop', () => {
    const stops = Array.from({ length: 20 }, (_, i) => i)
    const sampled = sampleStops(stops, 5)
    expect(sampled).toHaveLength(5)
    expect(sampled.at(-1)).toBe(19)
    expect(sampled[0]).toBe(0)
  })
})
