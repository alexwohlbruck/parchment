import { describe, expect, test } from 'vitest'
import { formatShareStatus, formatShareTimeLeft, shareExpiry, shareTimeLeft } from './share-duration'

const at = (y: number, mo: number, d: number, h: number, mi = 0) =>
  new Date(y, mo - 1, d, h, mi)

describe('shareExpiry', () => {
  const afternoon = at(2026, 11, 25, 15, 20)

  test('timed shares count from now', () => {
    expect(shareExpiry('1h', afternoon)).toEqual(at(2026, 11, 25, 16, 20))
    expect(shareExpiry('4h', afternoon)).toEqual(at(2026, 11, 25, 19, 20))
  })

  test('until tomorrow ends at 9 the next morning', () => {
    expect(shareExpiry('tomorrow', afternoon)).toEqual(at(2026, 11, 26, 9))
  })

  test('until tomorrow after midnight still means the coming morning', () => {
    expect(shareExpiry('tomorrow', at(2026, 11, 26, 1, 30))).toEqual(at(2026, 11, 26, 9))
  })

  test('until tomorrow early in the morning rolls to the next day', () => {
    expect(shareExpiry('tomorrow', at(2026, 11, 26, 5))).toEqual(at(2026, 11, 27, 9))
  })

  test('until tomorrow crosses a month end', () => {
    expect(shareExpiry('tomorrow', at(2026, 11, 30, 22))).toEqual(at(2026, 12, 1, 9))
  })

  test('indefinite shares have no end', () => {
    expect(shareExpiry('indefinite', afternoon)).toBeNull()
  })
})

describe('shareTimeLeft', () => {
  const now = at(2026, 11, 25, 12)

  test('under an hour counts minutes, rounding up', () => {
    expect(shareTimeLeft(at(2026, 11, 25, 12, 14), now)).toEqual({ unit: 'minute', value: 14 })
    expect(shareTimeLeft(new Date(now.getTime() + 1000), now)).toEqual({ unit: 'minute', value: 1 })
  })

  test('an hour or more counts whole hours', () => {
    expect(shareTimeLeft(at(2026, 11, 25, 15, 59), now)).toEqual({ unit: 'hour', value: 4 })
    expect(shareTimeLeft(at(2026, 11, 25, 13, 10), now)).toEqual({ unit: 'hour', value: 1 })
  })

  test('nothing is left once the share has ended', () => {
    expect(shareTimeLeft(now, now)).toBeNull()
    expect(shareTimeLeft(at(2026, 11, 25, 11), now)).toBeNull()
  })
})

describe('formatShareTimeLeft', () => {
  const now = at(2026, 11, 25, 12)
  const t = (key: string, named?: Record<string, unknown>) => `${key}:${named?.n}`

  test('names the unit that is left', () => {
    expect(formatShareTimeLeft(at(2026, 11, 25, 12, 30), t, now)).toBe('friends.sharing.minutesLeft:30')
    expect(formatShareTimeLeft(at(2026, 11, 25, 14), t, now)).toBe('friends.sharing.hoursLeft:2')
  })

  test('says nothing for an open-ended or ended share', () => {
    expect(formatShareTimeLeft(null, t, now)).toBeNull()
    expect(formatShareTimeLeft(at(2026, 11, 25, 11), t, now)).toBeNull()
  })
})

describe('formatShareStatus', () => {
  const now = at(2026, 11, 25, 15)
  const t = (key: string, named?: Record<string, unknown>) =>
    named ? `${key}(${Object.values(named).join()})` : key
  const hhmm = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`

  test('a share ending today names the time and what is left', () => {
    expect(formatShareStatus(at(2026, 11, 25, 16), t, hhmm, now)).toBe(
      'friends.sharing.until(16:00) · friends.sharing.hoursLeft(1)',
    )
  })

  test('a share ending tomorrow says so', () => {
    expect(formatShareStatus(at(2026, 11, 26, 9), t, hhmm, now)).toBe(
      'friends.sharing.untilTomorrow(9:00) · friends.sharing.hoursLeft(18)',
    )
  })

  test('an open-ended share runs until turned off', () => {
    expect(formatShareStatus(null, t, hhmm, now)).toBe('friends.sharing.untilTurnedOff')
  })
})
