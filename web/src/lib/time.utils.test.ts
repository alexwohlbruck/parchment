import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  formatDurationCompact,
  formatDurationLong,
  formatDurationParts,
  formatStopwatch,
  formatClockTime,
  timeAgoParts,
  formatTimeAgo,
} from './time.utils'

const t = (key: string, named?: Record<string, unknown>) =>
  named ? `${key}:${JSON.stringify(named)}` : key

afterEach(() => vi.useRealTimers())

describe('duration formats', () => {
  it('compact drops the hour when there is none', () => {
    expect(formatDurationCompact(300)).toBe('5m')
    expect(formatDurationCompact(7500)).toBe('2h 5m')
    expect(formatDurationCompact(7200)).toBe('2h 0m')
  })

  it('long spells the units and omits a zero remainder', () => {
    expect(formatDurationLong(300)).toBe('5 min')
    expect(formatDurationLong(7500)).toBe('2 hr 5 min')
    expect(formatDurationLong(7200)).toBe('2 hr')
  })

  it('parts splits value from unit for styled rendering', () => {
    expect(formatDurationParts(300)).toEqual({ parts: [{ value: 5, unit: 'min' }] })
    expect(formatDurationParts(7500)).toEqual({
      parts: [{ value: 2, unit: 'h' }, { value: 5, unit: 'm' }],
    })
    // An exact hour drops the minutes part rather than showing "0m".
    expect(formatDurationParts(7200)).toEqual({ parts: [{ value: 2, unit: 'h' }] })
  })

  it('stopwatch pads seconds and survives non-finite input', () => {
    expect(formatStopwatch(187)).toBe('3:07')
    expect(formatStopwatch(0)).toBe('0:00')
    // Playback math divides by a duration that can be zero.
    expect(formatStopwatch(NaN)).toBe('0:00')
    expect(formatStopwatch(-1)).toBe('0:00')
  })
})

describe('formatClockTime', () => {
  it('converts 24h to 12h with a period', () => {
    expect(formatClockTime('09:30')).toBe('9:30 AM')
    expect(formatClockTime('13:05')).toBe('1:05 PM')
  })

  it('renders midnight and noon as 12, not 0', () => {
    expect(formatClockTime('00:15')).toBe('12:15 AM')
    expect(formatClockTime('12:15')).toBe('12:15 PM')
  })

  it('omitZeroMinutes drops an exact hour’s minutes', () => {
    expect(formatClockTime('17:00', { omitZeroMinutes: true })).toBe('5 PM')
    expect(formatClockTime('17:30', { omitZeroMinutes: true })).toBe('5:30 PM')
    expect(formatClockTime('17:00')).toBe('5:00 PM')
  })
})

describe('timeAgoParts', () => {
  it('buckets by the largest whole unit', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-08-02T12:00:00Z'))
    const at = (iso: string) => timeAgoParts(iso)

    expect(at('2026-08-02T11:59:30Z')).toMatchObject({ unit: 'now' })
    expect(at('2026-08-02T11:55:00Z')).toMatchObject({ unit: 'minute', value: 5 })
    expect(at('2026-08-02T09:00:00Z')).toMatchObject({ unit: 'hour', value: 3 })
    expect(at('2026-07-30T12:00:00Z')).toMatchObject({ unit: 'day', value: 3 })
  })

  it('accepts a Date, an ISO string or an epoch number', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-08-02T12:00:00Z'))
    const ms = Date.parse('2026-08-02T11:55:00Z')
    expect(timeAgoParts(new Date(ms)).value).toBe(5)
    expect(timeAgoParts('2026-08-02T11:55:00Z').value).toBe(5)
    expect(timeAgoParts(ms).value).toBe(5)
  })

  it('clamps a future timestamp to "now" rather than going negative', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-08-02T12:00:00Z'))
    expect(timeAgoParts('2026-08-02T12:05:00Z')).toMatchObject({ unit: 'now' })
  })
})

describe('formatTimeAgo', () => {
  it('translates through the shared key namespace', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-08-02T12:00:00Z'))
    expect(formatTimeAgo('2026-08-02T11:59:30Z', t)).toBe('general.timeAgo.justNow')
    expect(formatTimeAgo('2026-08-02T11:55:00Z', t)).toBe('general.timeAgo.minutesAgo:{"n":5}')
    expect(formatTimeAgo('2026-08-02T09:00:00Z', t)).toBe('general.timeAgo.hoursAgo:{"n":3}')
    expect(formatTimeAgo('2026-07-30T12:00:00Z', t)).toBe('general.timeAgo.daysAgo:{"n":3}')
  })

  it('falls back to an absolute date once relative stops being useful', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-08-02T12:00:00Z'))
    const old = '2026-06-01T12:00:00Z'
    expect(formatTimeAgo(old, t)).not.toContain('general.timeAgo')

    // Callers that want relative wording indefinitely opt out.
    expect(formatTimeAgo(old, t, { absoluteAfterDays: Infinity })).toContain(
      'general.timeAgo.daysAgo',
    )
  })
})
