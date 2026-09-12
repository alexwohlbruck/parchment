import { describe, it, expect } from 'vitest'
import {
  parseOpeningHours,
  serializeOpeningHours,
  emptyWeek,
  WEEKDAYS,
} from './opening-hours-editor'

describe('parseOpeningHours', () => {
  it('parses a simple day-range rule', () => {
    const week = parseOpeningHours('Mo-Fr 09:00-17:00')!
    expect(week.Mo.intervals).toEqual(['09:00-17:00'])
    expect(week.Fr.intervals).toEqual(['09:00-17:00'])
    expect(week.Sa.intervals).toEqual([])
  })

  it('parses multiple rules with day lists and split intervals', () => {
    const week = parseOpeningHours('Mo,We 08:00-12:00,13:00-18:00; Su off')!
    expect(week.Mo.intervals).toEqual(['08:00-12:00', '13:00-18:00'])
    expect(week.We.intervals).toEqual(['08:00-12:00', '13:00-18:00'])
    expect(week.Tu.intervals).toEqual([])
    expect(week.Su.intervals).toEqual([])
  })

  it('parses wrap-around day ranges', () => {
    const week = parseOpeningHours('Sa-Mo 10:00-16:00')!
    expect(week.Sa.intervals).toEqual(['10:00-16:00'])
    expect(week.Su.intervals).toEqual(['10:00-16:00'])
    expect(week.Mo.intervals).toEqual(['10:00-16:00'])
    expect(week.Tu.intervals).toEqual([])
  })

  it('parses 24/7', () => {
    const week = parseOpeningHours('24/7')!
    for (const day of WEEKDAYS) {
      expect(week[day].intervals).toEqual(['00:00-24:00'])
    }
  })

  it('rejects grammar outside the subset', () => {
    expect(parseOpeningHours('Mo-Fr 09:00-17:00; PH off')).toBeNull()
    expect(parseOpeningHours('Jun-Aug Mo 10:00-14:00')).toBeNull()
    expect(parseOpeningHours('Mo sunrise-sunset')).toBeNull()
    expect(parseOpeningHours('Mo-Fr 09:00-17:00 "by appointment"')).toBeNull()
  })
})

describe('serializeOpeningHours', () => {
  it('round-trips a value, grouping identical days', () => {
    const week = parseOpeningHours('Mo-Fr 09:00-17:00; Sa 10:00-14:00')!
    expect(serializeOpeningHours(week)).toBe('Mo-Fr 09:00-17:00; Sa 10:00-14:00')
  })

  it('collapses a full 00:00-24:00 week to 24/7', () => {
    const week = parseOpeningHours('24/7')!
    expect(serializeOpeningHours(week)).toBe('24/7')
  })

  it('serializes an empty week to an empty string', () => {
    expect(serializeOpeningHours(emptyWeek())).toBe('')
  })

  it('lists non-consecutive days instead of a range', () => {
    const week = emptyWeek()
    week.Mo.intervals = ['09:00-17:00']
    week.We.intervals = ['09:00-17:00']
    expect(serializeOpeningHours(week)).toBe('Mo,We 09:00-17:00')
  })
})
