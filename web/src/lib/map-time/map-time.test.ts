import { describe, expect, test } from 'vitest'
import { dateAtDaySlot, minutesOfDay, weekdayIndex } from './map-time'

describe('map time construction', () => {
  // 2026-08-17 is a Monday
  const monday = new Date(2026, 7, 17, 9, 41, 30)

  test('weekdayIndex is Monday-first', () => {
    expect(weekdayIndex(monday)).toBe(0)
    expect(weekdayIndex(new Date(2026, 7, 23))).toBe(6)
  })

  test('same-day slot keeps the date and sets the time', () => {
    const d = dateAtDaySlot(0, 14 * 60 + 5, monday)
    expect(d.getDate()).toBe(17)
    expect(d.getHours()).toBe(14)
    expect(d.getMinutes()).toBe(5)
    expect(d.getSeconds()).toBe(0)
  })

  test('an earlier weekday rolls into next week, never backwards', () => {
    const thursday = new Date(2026, 7, 20, 12, 0)
    const d = dateAtDaySlot(1, 30, thursday)
    expect(weekdayIndex(d)).toBe(1)
    expect(d.getTime()).toBeGreaterThan(thursday.getTime())
    expect(d.getDate()).toBe(25)
  })

  test('round-trips through minutesOfDay and weekdayIndex', () => {
    for (let day = 0; day < 7; day++) {
      const d = dateAtDaySlot(day, 23 * 60 + 55, monday)
      expect(weekdayIndex(d)).toBe(day)
      expect(minutesOfDay(d)).toBe(23 * 60 + 55)
    }
  })
})
