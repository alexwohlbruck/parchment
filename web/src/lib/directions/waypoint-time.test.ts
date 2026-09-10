import { describe, it, expect } from 'vitest'
import dayjs from 'dayjs'
import {
  buildConstraint,
  constraintRequestFields,
  constraintSummary,
  constraintWarning,
  formatDwell,
  roundUpToFive,
  waypointRole,
} from './waypoint-time'
import type { WaypointTimeConstraint } from '@/types/map.types'

const at = (time: string) => dayjs(`2026-01-15T${time}`)

describe('waypointRole', () => {
  it('names each end of the trip and everything between', () => {
    expect(waypointRole(0, 3)).toBe('origin')
    expect(waypointRole(1, 3)).toBe('stop')
    expect(waypointRole(2, 3)).toBe('destination')
  })
})

describe('roundUpToFive', () => {
  it('nudges an awkward time up to something a person would plan', () => {
    expect(roundUpToFive(at('13:37')).format('HH:mm')).toBe('13:40')
  })

  it('leaves a time that already lands on five alone', () => {
    expect(roundUpToFive(at('13:35')).format('HH:mm')).toBe('13:35')
  })

  it('rolls over the hour', () => {
    expect(roundUpToFive(at('13:58')).format('HH:mm')).toBe('14:00')
  })
})

describe('formatDwell', () => {
  it('reads as a duration rather than a number of minutes', () => {
    expect(formatDwell(45)).toBe('45 min')
    expect(formatDwell(60)).toBe('1 hr')
    expect(formatDwell(90)).toBe('1 hr 30 min')
  })
})

describe('constraintSummary', () => {
  it('states the rider\'s own instruction', () => {
    expect(constraintSummary({ mode: 'departAfter', time: at('13:30').toISOString() }, null))
      .toEqual({ text: 'From 1:30 PM', tone: 'set' })
    expect(constraintSummary({ mode: 'arriveBy', time: at('13:30').toISOString() }, null))
      .toEqual({ text: 'By 1:30 PM', tone: 'set' })
  })

  it('shows a stay when that is all that was asked for', () => {
    expect(constraintSummary({ mode: 'departAfter', dwellTime: 30 } as never, null))
      .toEqual({ text: '30 min', tone: 'set' })
  })

  it('falls back to what the trip implies, quietly', () => {
    expect(constraintSummary(null, at('13:29').toDate()))
      .toEqual({ text: '1:29 PM', tone: 'derived' })
  })

  it('prefers the instruction over the implication', () => {
    const summary = constraintSummary(
      { mode: 'departAfter', time: at('14:00').toISOString() },
      at('13:29').toDate(),
    )
    expect(summary).toEqual({ text: 'From 2:00 PM', tone: 'set' })
  })

  it('has nothing to say when neither exists', () => {
    expect(constraintSummary(null, null)).toBeNull()
  })
})

describe('constraintWarning', () => {
  const now = at('12:00')

  it('passes a workable constraint', () => {
    expect(constraintWarning({ time: at('13:00'), dwellMinutes: null, now })).toBeNull()
  })

  it('catches a time already gone', () => {
    expect(constraintWarning({ time: at('11:00'), dwellMinutes: null, now }))
      .toBe('That time has passed.')
  })

  it('counts the previous stop\'s stay before deciding this one is early', () => {
    const previous = { mode: 'departAfter' as const, time: at('12:30').toISOString(), dwellTime: 45 }
    expect(constraintWarning({ time: at('13:00'), dwellMinutes: null, previous, now }))
      .toBe("The stop before this one isn't free until 1:15 PM.")
    expect(constraintWarning({ time: at('13:30'), dwellMinutes: null, previous, now }))
      .toBeNull()
  })

  it('counts this stop\'s stay before deciding the next one is missed', () => {
    const next = { mode: 'arriveBy' as const, time: at('14:00').toISOString() }
    expect(constraintWarning({ time: at('13:00'), dwellMinutes: 30, next, now })).toBeNull()
    expect(constraintWarning({ time: at('13:00'), dwellMinutes: 90, next, now }))
      .toBe('Leaving at 2:30 PM misses the next stop.')
  })

  it('reports nothing when only a stay is being set', () => {
    expect(constraintWarning({ time: null, dwellMinutes: 30, now })).toBeNull()
  })
})

describe('buildConstraint', () => {
  const draft = (over = {}) => ({ mode: 'departAfter' as const, time: null, dwellMinutes: null, ...over })

  it('asks for nothing when nothing was set', () => {
    expect(buildConstraint(draft())).toBeNull()
  })

  it('carries a time on its own', () => {
    expect(buildConstraint(draft({ time: at('13:30') }))).toEqual({
      mode: 'departAfter',
      time: at('13:30').toISOString(),
    })
  })

  it('carries a stay on its own, with no time invented for it', () => {
    expect(buildConstraint(draft({ dwellMinutes: 30 }))).toEqual({
      mode: 'departAfter',
      dwellTime: 30,
    })
  })

  it('drops a stay of zero rather than recording one', () => {
    expect(buildConstraint(draft({ time: at('13:30'), dwellMinutes: 0 })))
      .toEqual({ mode: 'departAfter', time: at('13:30').toISOString() })
    expect(buildConstraint(draft({ dwellMinutes: -5 }))).toBeNull()
  })
})

describe('constraintRequestFields', () => {
  const time = at('13:30').toISOString()

  it('sends nothing for a waypoint with no constraint', () => {
    expect(constraintRequestFields(null)).toEqual({})
    expect(constraintRequestFields(undefined)).toEqual({})
  })

  it('sends the time under the field its mode names', () => {
    expect(constraintRequestFields({ mode: 'departAfter', time })).toEqual({ departAfter: time })
    expect(constraintRequestFields({ mode: 'arriveBy', time })).toEqual({ arriveBy: time })
  })

  it('sends a stay even when no time was set', () => {
    expect(constraintRequestFields({ mode: 'departAfter', dwellTime: 20 }))
      .toEqual({ dwellTime: 20 })
  })

  it('sends both when both were set', () => {
    expect(constraintRequestFields({ mode: 'arriveBy', time, dwellTime: 15 }))
      .toEqual({ arriveBy: time, dwellTime: 15 })
  })
})

describe('a schedule down a multi-stop trip', () => {
  const now = at('12:00')

  it('accepts stops that leave room for each other', () => {
    const stops: WaypointTimeConstraint[] = [
      { mode: 'departAfter', time: at('13:00').toISOString() },
      { mode: 'departAfter', time: at('14:00').toISOString(), dwellTime: 10 },
      { mode: 'arriveBy', time: at('15:30').toISOString(), dwellTime: 5 },
      { mode: 'arriveBy', time: at('17:00').toISOString() },
    ]

    stops.forEach((stop, i) => {
      expect(constraintWarning({
        time: dayjs(stop.time), dwellMinutes: stop.dwellTime ?? null,
        previous: stops[i - 1], next: stops[i + 1], now,
      })).toBeNull()
    })
  })

  it('catches a stop scheduled before the one before it', () => {
    const stops: WaypointTimeConstraint[] = [
      { mode: 'departAfter', time: at('13:00').toISOString() },
      { mode: 'departAfter', time: at('12:30').toISOString() },
      { mode: 'arriveBy', time: at('15:00').toISOString() },
    ]

    expect(constraintWarning({
      time: dayjs(stops[1].time), dwellMinutes: null,
      previous: stops[0], next: stops[2], now,
    })).toContain("isn't free until")
  })

  it('catches a stay that runs into the next stop', () => {
    expect(constraintWarning({
      time: at('13:50'), dwellMinutes: 30,
      previous: { mode: 'departAfter', time: at('13:00').toISOString() },
      next: { mode: 'arriveBy', time: at('14:00').toISOString() },
      now,
    })).toContain('misses the next stop')
  })
})
