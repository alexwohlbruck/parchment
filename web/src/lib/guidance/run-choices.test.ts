import { describe, expect, test } from 'vitest'
import { runChoices, type RunChoiceInput } from './run-choices'
import type { VehicleCandidate } from './vehicle-switch'

const T = Date.parse('2026-11-08T20:00:00Z')
const min = (n: number) => T + n * 60_000

const run = (tripId: string, departs: number, arrives: number | null = departs + 10): VehicleCandidate => ({
  tripId,
  line: 'L',
  departureMs: min(departs),
  calls: arrives == null ? [] : [{ stop: 'alight', timeMs: min(arrives) }],
})

const input = (candidates: VehicleCandidate[], over: Partial<RunChoiceInput> = {}): RunChoiceInput => ({
  set: { candidates, known: ['alight'] },
  bookedTripId: 'booked',
  bookedMs: min(9),
  alightStop: 'alight',
  nowMs: T,
  walkSec: 8 * 60,
  runFactor: 1.6,
  ...over,
})

const ids = (choices: ReturnType<typeof runChoices>) => choices.map(c => c.candidate.tripId)

describe('runChoices', () => {
  test('lists the runs in reach soonest first, the booked one marked', () => {
    const choices = runChoices(input([run('later', 14), run('booked', 9), run('after', 19)]))
    expect(ids(choices)).toEqual(['booked', 'later', 'after'])
    expect(choices.map(c => c.booked)).toEqual([true, false, false])
  })

  test('says which runs need a run to make', () => {
    const [soon, comfortable] = runChoices(input([run('booked', 6), run('later', 14)]))
    expect(soon.reach).toBe('run')
    expect(comfortable.reach).toBe('ok')
  })

  test('drops runs out of reach even at a run, and ones already gone', () => {
    const choices = runChoices(input([run('gone', -1), run('far', 2), run('booked', 9)]))
    expect(ids(choices)).toEqual(['booked'])
  })

  test('keeps the booked run while it is still to come, even out of reach', () => {
    expect(ids(runChoices(input([run('booked', 2), run('later', 14)])))).toEqual(['booked', 'later'])
  })

  test('skips runs that pass the stop the rider gets off at', () => {
    const choices = runChoices(input([run('booked', 9), run('express', 12, null)]))
    expect(ids(choices)).toEqual(['booked'])
    expect(choices[0].arrivalMs).toBe(min(19))
  })

  test('without a trip id, the run leaving at the booked time is the booked one', () => {
    const choices = runChoices(input([run('a', 9.5), run('b', 14)], { bookedTripId: undefined }))
    expect(choices.map(c => c.booked)).toEqual([true, false])
  })
})
