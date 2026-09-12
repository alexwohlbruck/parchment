import { describe, it, expect } from 'vitest'
import { legHandoffTimes } from './leg-times'
import type { TripOption } from '@/types/directions.types'

const at = (time: string) => new Date(`2026-01-15T${time}:00Z`)

function trip(...segments: Array<[number, string, string]>): TripOption {
  return {
    segments: segments.map(([legIndex, startTime, endTime]) => ({
      legIndex, startTime: at(startTime), endTime: at(endTime),
    })),
  } as unknown as TripOption
}

describe('legHandoffTimes', () => {
  it('reports when each intermediate stop is reached', () => {
    const times = legHandoffTimes(trip(
      [0, '08:00', '08:20'],
      [1, '08:20', '08:45'],
    ))

    expect([...times.keys()]).toEqual([1])
    expect(times.get(1)).toEqual(at('08:20'))
  })

  it('takes the end of the leg, not of its first segment', () => {
    const times = legHandoffTimes(trip(
      [0, '08:00', '08:05'],
      [0, '08:05', '08:30'],
      [1, '08:30', '08:50'],
    ))

    expect(times.get(1)).toEqual(at('08:30'))
  })

  it('leaves out the destination, which nothing departs from', () => {
    const times = legHandoffTimes(trip(
      [0, '08:00', '08:20'],
      [1, '08:20', '08:45'],
      [2, '08:45', '09:10'],
    ))

    expect([...times.keys()].sort()).toEqual([1, 2])
    expect(times.has(3)).toBe(false)
  })

  it('has nothing to report for a single-leg trip', () => {
    expect(legHandoffTimes(trip([0, '08:00', '08:20'])).size).toBe(0)
  })

  it('tolerates having no trip at all', () => {
    expect(legHandoffTimes(undefined).size).toBe(0)
  })
})
