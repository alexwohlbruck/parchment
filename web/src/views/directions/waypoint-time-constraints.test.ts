/**
 * Tests for per-waypoint time constraint validation and behavior.
 *
 * Covers:
 * - Mode availability (origin → depart only, destination → arrive only, intermediate → both)
 * - Validation: ordering conflicts, dwell-time conflicts, past-time warnings
 * - Edge cases: same time, midnight crossing, null/undefined constraints
 * - Constraint emission: correct shape for departAfter/arriveBy/dwellTime
 * - Integration: constraint mapping into TripRequest
 */

import { describe, test, expect } from 'vitest'
import dayjs from 'dayjs'
import type { WaypointTimeConstraint, WaypointTimeMode } from '@/types/map.types'

// ═══════════════════════════════════════════════════════════════════
// Extract the validation logic as pure functions for testing.
// These mirror the computed properties in WaypointTimePopover.vue.
// ═══════════════════════════════════════════════════════════════════

/** Determine available modes for a waypoint at a given position. */
function getAvailableModes(
  index: number,
  waypointCount: number,
): WaypointTimeMode[] {
  if (index === 0) return ['departAfter']
  if (index === waypointCount - 1) return ['arriveBy']
  return ['departAfter', 'arriveBy']
}

/** Validate a time constraint against its neighbors. Returns warning message or null. */
function validateTimeConstraint(
  timeIso: string | null,
  dwellMinutes: number | null,
  prevConstraint: WaypointTimeConstraint | null | undefined,
  nextConstraint: WaypointTimeConstraint | null | undefined,
  now?: dayjs.Dayjs, // injectable for deterministic tests
): string | null {
  if (!timeIso) return null
  const time = dayjs(timeIso)
  if (!time.isValid()) return null

  // Check against previous waypoint
  if (prevConstraint?.time) {
    const prevTime = dayjs(prevConstraint.time)
    const prevDwell = prevConstraint.dwellTime ?? 0
    const earliestHere = prevTime.add(prevDwell, 'minute')

    if (time.isBefore(earliestHere)) {
      const diff = earliestHere.diff(time, 'minute')
      return `This is ${diff} min before the previous stop's departure${prevDwell ? ` + ${prevDwell} min dwell` : ''}. Allow more time between stops.`
    }
  }

  // Check against next waypoint
  if (nextConstraint?.time) {
    const nextTime = dayjs(nextConstraint.time)
    const thisDwell = Math.max(0, dwellMinutes ?? 0)
    const latestDepart = time.add(thisDwell, 'minute')

    if (latestDepart.isAfter(nextTime)) {
      return `Departing here${thisDwell ? ` with ${thisDwell} min dwell` : ''} would miss the next stop's time. Adjust the schedule.`
    }
  }

  // Check if time is in the past
  const ref = now ?? dayjs()
  if (time.isBefore(ref)) {
    return 'This time is in the past.'
  }

  return null
}

/** Build the constraint object that would be emitted. */
function buildConstraint(
  mode: WaypointTimeMode,
  timeLocal: string,
  dwellMinutes: number | null,
): WaypointTimeConstraint | null {
  if (!timeLocal) return null
  return {
    mode,
    time: new Date(timeLocal).toISOString(),
    ...(dwellMinutes != null && dwellMinutes > 0 && { dwellTime: dwellMinutes }),
  }
}

/** Map a client Waypoint's time constraint to server request fields. */
function mapConstraintToRequest(constraint: WaypointTimeConstraint | null | undefined) {
  if (!constraint) return {}
  return {
    ...(constraint.mode === 'departAfter' && { departAfter: constraint.time }),
    ...(constraint.mode === 'arriveBy' && { arriveBy: constraint.time }),
    ...(constraint.dwellTime && { dwellTime: constraint.dwellTime }),
  }
}

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════

describe('getAvailableModes', () => {
  test('origin (index 0) can only depart', () => {
    expect(getAvailableModes(0, 2)).toEqual(['departAfter'])
    expect(getAvailableModes(0, 3)).toEqual(['departAfter'])
    expect(getAvailableModes(0, 5)).toEqual(['departAfter'])
  })

  test('destination (last index) can only arrive', () => {
    expect(getAvailableModes(1, 2)).toEqual(['arriveBy'])
    expect(getAvailableModes(2, 3)).toEqual(['arriveBy'])
    expect(getAvailableModes(4, 5)).toEqual(['arriveBy'])
  })

  test('intermediate stops get both modes', () => {
    expect(getAvailableModes(1, 3)).toEqual(['departAfter', 'arriveBy'])
    expect(getAvailableModes(2, 5)).toEqual(['departAfter', 'arriveBy'])
    expect(getAvailableModes(1, 4)).toEqual(['departAfter', 'arriveBy'])
  })

  test('two-waypoint trip: origin departs, destination arrives', () => {
    expect(getAvailableModes(0, 2)).toEqual(['departAfter'])
    expect(getAvailableModes(1, 2)).toEqual(['arriveBy'])
  })
})

describe('validateTimeConstraint', () => {
  // Use a fixed "now" so past-time checks are deterministic
  const now = dayjs('2026-06-03T12:00:00.000Z')

  describe('no constraint', () => {
    test('null time returns null', () => {
      expect(validateTimeConstraint(null, null, null, null, now)).toBeNull()
    })

    test('empty string time returns null', () => {
      expect(validateTimeConstraint('', null, null, null, now)).toBeNull()
    })

    test('invalid date returns null', () => {
      expect(validateTimeConstraint('not-a-date', null, null, null, now)).toBeNull()
    })
  })

  describe('no neighbors', () => {
    test('future time with no neighbors is valid', () => {
      expect(validateTimeConstraint(
        '2026-06-03T14:00:00.000Z',
        null, null, null, now,
      )).toBeNull()
    })

    test('past time warns', () => {
      const result = validateTimeConstraint(
        '2026-06-03T10:00:00.000Z',
        null, null, null, now,
      )
      expect(result).toBe('This time is in the past.')
    })
  })

  describe('previous waypoint conflicts', () => {
    test('time after previous is valid', () => {
      const prev: WaypointTimeConstraint = {
        mode: 'departAfter',
        time: '2026-06-03T13:00:00.000Z',
      }
      expect(validateTimeConstraint(
        '2026-06-03T14:00:00.000Z',
        null, prev, null, now,
      )).toBeNull()
    })

    test('time before previous warns', () => {
      const prev: WaypointTimeConstraint = {
        mode: 'departAfter',
        time: '2026-06-03T15:00:00.000Z',
      }
      const result = validateTimeConstraint(
        '2026-06-03T14:00:00.000Z',
        null, prev, null, now,
      )
      expect(result).toContain('min before the previous stop')
      expect(result).toContain('Allow more time')
    })

    test('time exactly equal to previous is valid (not before)', () => {
      const prev: WaypointTimeConstraint = {
        mode: 'departAfter',
        time: '2026-06-03T14:00:00.000Z',
      }
      // dayjs('2026-06-03T14:00:00.000Z').isBefore(dayjs('2026-06-03T14:00:00.000Z')) = false
      expect(validateTimeConstraint(
        '2026-06-03T14:00:00.000Z',
        null, prev, null, now,
      )).toBeNull()
    })

    test('previous with dwell time shifts the threshold', () => {
      const prev: WaypointTimeConstraint = {
        mode: 'departAfter',
        time: '2026-06-03T13:00:00.000Z',
        dwellTime: 30, // 30 min at prev stop
      }
      // Earliest here = 13:00 + 30 = 13:30
      // Arriving at 13:15 → 15 min too early
      const result = validateTimeConstraint(
        '2026-06-03T13:15:00.000Z',
        null, prev, null, now,
      )
      expect(result).toContain('15 min before')
      expect(result).toContain('+ 30 min dwell')
    })

    test('previous with dwell time, arriving after dwell is valid', () => {
      const prev: WaypointTimeConstraint = {
        mode: 'departAfter',
        time: '2026-06-03T13:00:00.000Z',
        dwellTime: 30,
      }
      // Earliest here = 13:00 + 30 = 13:30
      // Arriving at 14:00 → valid
      expect(validateTimeConstraint(
        '2026-06-03T14:00:00.000Z',
        null, prev, null, now,
      )).toBeNull()
    })
  })

  describe('next waypoint conflicts', () => {
    test('time before next is valid', () => {
      const next: WaypointTimeConstraint = {
        mode: 'arriveBy',
        time: '2026-06-03T16:00:00.000Z',
      }
      expect(validateTimeConstraint(
        '2026-06-03T14:00:00.000Z',
        null, null, next, now,
      )).toBeNull()
    })

    test('time after next warns', () => {
      const next: WaypointTimeConstraint = {
        mode: 'arriveBy',
        time: '2026-06-03T13:00:00.000Z',
      }
      const result = validateTimeConstraint(
        '2026-06-03T14:00:00.000Z',
        null, null, next, now,
      )
      expect(result).toContain('would miss the next stop')
    })

    test('dwell time causes conflict with next', () => {
      const next: WaypointTimeConstraint = {
        mode: 'arriveBy',
        time: '2026-06-03T14:30:00.000Z',
      }
      // Depart from here = 14:00 + 45 min dwell = 14:45
      // Next is at 14:30 → conflict
      const result = validateTimeConstraint(
        '2026-06-03T14:00:00.000Z',
        45, // 45 min dwell
        null, next, now,
      )
      expect(result).toContain('with 45 min dwell')
      expect(result).toContain('would miss the next stop')
    })

    test('dwell time that fits before next is valid', () => {
      const next: WaypointTimeConstraint = {
        mode: 'arriveBy',
        time: '2026-06-03T15:00:00.000Z',
      }
      // Depart from here = 14:00 + 30 min dwell = 14:30
      // Next is at 15:00 → valid
      expect(validateTimeConstraint(
        '2026-06-03T14:00:00.000Z',
        30, null, next, now,
      )).toBeNull()
    })
  })

  describe('both neighbors', () => {
    test('squeezed between valid neighbors is valid', () => {
      const prev: WaypointTimeConstraint = {
        mode: 'departAfter',
        time: '2026-06-03T13:00:00.000Z',
      }
      const next: WaypointTimeConstraint = {
        mode: 'arriveBy',
        time: '2026-06-03T16:00:00.000Z',
      }
      expect(validateTimeConstraint(
        '2026-06-03T14:00:00.000Z',
        null, prev, next, now,
      )).toBeNull()
    })

    test('before previous takes priority over next conflict', () => {
      const prev: WaypointTimeConstraint = {
        mode: 'departAfter',
        time: '2026-06-03T15:00:00.000Z',
      }
      const next: WaypointTimeConstraint = {
        mode: 'arriveBy',
        time: '2026-06-03T13:00:00.000Z',
      }
      // Time is 14:00 — before prev (15:00), so prev conflict fires first
      const result = validateTimeConstraint(
        '2026-06-03T14:00:00.000Z',
        null, prev, next, now,
      )
      expect(result).toContain('before the previous stop')
    })

    test('valid vs prev but invalid vs next shows next warning', () => {
      const prev: WaypointTimeConstraint = {
        mode: 'departAfter',
        time: '2026-06-03T13:00:00.000Z',
      }
      const next: WaypointTimeConstraint = {
        mode: 'arriveBy',
        time: '2026-06-03T14:30:00.000Z',
      }
      // Time 14:00 + 60 min dwell = 15:00, but next is 14:30
      const result = validateTimeConstraint(
        '2026-06-03T14:00:00.000Z',
        60, prev, next, now,
      )
      expect(result).toContain('would miss the next stop')
    })
  })

  describe('edge cases', () => {
    test('midnight crossing: prev at 23:30, current at 00:15 next day', () => {
      const prev: WaypointTimeConstraint = {
        mode: 'departAfter',
        time: '2026-06-03T23:30:00.000Z',
      }
      expect(validateTimeConstraint(
        '2026-06-04T00:15:00.000Z',
        null, prev, null,
        dayjs('2026-06-03T23:00:00.000Z'),
      )).toBeNull()
    })

    test('zero dwell time is treated as no dwell', () => {
      const next: WaypointTimeConstraint = {
        mode: 'arriveBy',
        time: '2026-06-03T14:30:00.000Z',
      }
      // Time 14:00 + 0 dwell → departs at 14:00, before 14:30 → valid
      expect(validateTimeConstraint(
        '2026-06-03T14:00:00.000Z',
        0, null, next, now,
      )).toBeNull()
    })

    test('negative dwell time is treated as 0', () => {
      const next: WaypointTimeConstraint = {
        mode: 'arriveBy',
        time: '2026-06-03T14:30:00.000Z',
      }
      expect(validateTimeConstraint(
        '2026-06-03T14:00:00.000Z',
        -10, null, next, now,
      )).toBeNull()
    })

    test('prev constraint with no time set is ignored', () => {
      const prev = { mode: 'departAfter' as const, time: '' }
      expect(validateTimeConstraint(
        '2026-06-03T14:00:00.000Z',
        null, prev, null, now,
      )).toBeNull()
    })

    test('undefined neighbors are handled', () => {
      expect(validateTimeConstraint(
        '2026-06-03T14:00:00.000Z',
        null, undefined, undefined, now,
      )).toBeNull()
    })
  })
})

describe('buildConstraint', () => {
  test('empty time returns null', () => {
    expect(buildConstraint('departAfter', '', null)).toBeNull()
  })

  test('departAfter without dwell', () => {
    const result = buildConstraint('departAfter', '2026-06-03T14:00:00.000Z', null)
    expect(result).not.toBeNull()
    expect(result!.mode).toBe('departAfter')
    expect(result!.time).toBe(new Date('2026-06-03T14:00:00.000Z').toISOString())
    expect(result!.dwellTime).toBeUndefined()
  })

  test('arriveBy without dwell', () => {
    const result = buildConstraint('arriveBy', '2026-06-03T16:00:00.000Z', null)
    expect(result!.mode).toBe('arriveBy')
  })

  test('with dwell time', () => {
    const result = buildConstraint('departAfter', '2026-06-03T14:00:00.000Z', 15)
    expect(result!.dwellTime).toBe(15)
  })

  test('zero dwell is omitted', () => {
    const result = buildConstraint('departAfter', '2026-06-03T14:00:00.000Z', 0)
    expect(result!.dwellTime).toBeUndefined()
  })

  test('negative dwell is omitted', () => {
    const result = buildConstraint('departAfter', '2026-06-03T14:00:00.000Z', -5)
    expect(result!.dwellTime).toBeUndefined()
  })
})

describe('mapConstraintToRequest', () => {
  test('null constraint returns empty object', () => {
    expect(mapConstraintToRequest(null)).toEqual({})
  })

  test('undefined constraint returns empty object', () => {
    expect(mapConstraintToRequest(undefined)).toEqual({})
  })

  test('departAfter maps to departAfter field', () => {
    const constraint: WaypointTimeConstraint = {
      mode: 'departAfter',
      time: '2026-06-03T14:00:00.000Z',
    }
    expect(mapConstraintToRequest(constraint)).toEqual({
      departAfter: '2026-06-03T14:00:00.000Z',
    })
  })

  test('arriveBy maps to arriveBy field', () => {
    const constraint: WaypointTimeConstraint = {
      mode: 'arriveBy',
      time: '2026-06-03T16:00:00.000Z',
    }
    expect(mapConstraintToRequest(constraint)).toEqual({
      arriveBy: '2026-06-03T16:00:00.000Z',
    })
  })

  test('departAfter with dwell includes both fields', () => {
    const constraint: WaypointTimeConstraint = {
      mode: 'departAfter',
      time: '2026-06-03T14:00:00.000Z',
      dwellTime: 20,
    }
    expect(mapConstraintToRequest(constraint)).toEqual({
      departAfter: '2026-06-03T14:00:00.000Z',
      dwellTime: 20,
    })
  })

  test('arriveBy with dwell includes both fields', () => {
    const constraint: WaypointTimeConstraint = {
      mode: 'arriveBy',
      time: '2026-06-03T16:00:00.000Z',
      dwellTime: 10,
    }
    expect(mapConstraintToRequest(constraint)).toEqual({
      arriveBy: '2026-06-03T16:00:00.000Z',
      dwellTime: 10,
    })
  })

  test('constraint without dwell omits dwellTime', () => {
    const constraint: WaypointTimeConstraint = {
      mode: 'departAfter',
      time: '2026-06-03T14:00:00.000Z',
    }
    const result = mapConstraintToRequest(constraint)
    expect(result).not.toHaveProperty('dwellTime')
  })
})

describe('multi-stop scenarios', () => {
  const now = dayjs('2026-06-03T12:00:00.000Z')

  test('3-stop trip: origin depart 13:00, via arrive 14:00 + 15min dwell, dest arrive 16:00', () => {
    const origin: WaypointTimeConstraint = {
      mode: 'departAfter',
      time: '2026-06-03T13:00:00.000Z',
    }
    const via: WaypointTimeConstraint = {
      mode: 'arriveBy',
      time: '2026-06-03T14:00:00.000Z',
      dwellTime: 15,
    }
    const dest: WaypointTimeConstraint = {
      mode: 'arriveBy',
      time: '2026-06-03T16:00:00.000Z',
    }

    // Origin: valid (no prev)
    expect(validateTimeConstraint(origin.time, null, null, via, now)).toBeNull()

    // Via: valid (after origin, before dest even with dwell)
    expect(validateTimeConstraint(via.time, via.dwellTime ?? null, origin, dest, now)).toBeNull()

    // Dest: valid (after via + dwell)
    expect(validateTimeConstraint(dest.time, null, via, null, now)).toBeNull()
  })

  test('3-stop trip with tight schedule warns on via', () => {
    const origin: WaypointTimeConstraint = {
      mode: 'departAfter',
      time: '2026-06-03T13:00:00.000Z',
    }
    const via: WaypointTimeConstraint = {
      mode: 'departAfter',
      time: '2026-06-03T13:50:00.000Z',
      dwellTime: 30, // departing at 14:20
    }
    const dest: WaypointTimeConstraint = {
      mode: 'arriveBy',
      time: '2026-06-03T14:00:00.000Z', // but dest is at 14:00!
    }

    // Via with 30min dwell → departs 14:20, but dest is 14:00
    const result = validateTimeConstraint(via.time, via.dwellTime ?? null, origin, dest, now)
    expect(result).toContain('would miss the next stop')
  })

  test('4-stop trip: all valid in sequence', () => {
    const stops: WaypointTimeConstraint[] = [
      { mode: 'departAfter', time: '2026-06-03T13:00:00.000Z' },
      { mode: 'departAfter', time: '2026-06-03T14:00:00.000Z', dwellTime: 10 },
      { mode: 'arriveBy', time: '2026-06-03T15:30:00.000Z', dwellTime: 5 },
      { mode: 'arriveBy', time: '2026-06-03T17:00:00.000Z' },
    ]

    for (let i = 0; i < stops.length; i++) {
      const prev = i > 0 ? stops[i - 1] : null
      const next = i < stops.length - 1 ? stops[i + 1] : null
      expect(validateTimeConstraint(
        stops[i].time, stops[i].dwellTime ?? null, prev, next, now,
      )).toBeNull()
    }
  })

  test('4-stop trip: out-of-order stop 2 warns', () => {
    const stops: WaypointTimeConstraint[] = [
      { mode: 'departAfter', time: '2026-06-03T13:00:00.000Z' },
      { mode: 'departAfter', time: '2026-06-03T12:30:00.000Z' }, // before stop 0!
      { mode: 'arriveBy', time: '2026-06-03T15:00:00.000Z' },
      { mode: 'arriveBy', time: '2026-06-03T17:00:00.000Z' },
    ]

    const result = validateTimeConstraint(
      stops[1].time, null, stops[0], stops[2], now,
    )
    expect(result).toContain('before the previous stop')
  })
})

describe('mode auto-correction', () => {
  test('origin forced to departAfter', () => {
    const modes = getAvailableModes(0, 3)
    expect(modes).not.toContain('arriveBy')
  })

  test('destination forced to arriveBy', () => {
    const modes = getAvailableModes(2, 3)
    expect(modes).not.toContain('departAfter')
  })

  test('when waypoint count changes from 3 to 2, index 1 becomes destination', () => {
    // Before: index 1 of 3 = intermediate (both modes)
    expect(getAvailableModes(1, 3)).toEqual(['departAfter', 'arriveBy'])
    // After: index 1 of 2 = destination (arriveBy only)
    expect(getAvailableModes(1, 2)).toEqual(['arriveBy'])
  })
})
