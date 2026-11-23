import { describe, expect, it } from 'vitest'
import { addDays, isExpired, localDay } from './expiry'

describe('isExpired', () => {
  const evening = new Date(2026, 10, 22, 23, 30)

  it('keeps an area through its last day and drops it the day after', () => {
    expect(isExpired('2026-11-22', evening)).toBe(false)
    expect(isExpired('2026-11-21', evening)).toBe(true)
  })

  it('never expires an area kept until it is deleted', () => {
    expect(isExpired(undefined, evening)).toBe(false)
  })

  it('counts days across a month end', () => {
    expect(localDay(addDays(evening, 10))).toBe('2026-12-02')
  })
})
