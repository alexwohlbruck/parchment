import { describe, expect, test } from 'bun:test'
import { isValidStay } from './stay-dates'

const now = new Date('2026-11-25T15:00:00Z')

describe('isValidStay', () => {
  test('accepts tonight to tomorrow', () => {
    expect(isValidStay('2026-11-25', '2026-11-26', now)).toBe(true)
  })

  test('accepts yesterday, for a guest still on the previous day', () => {
    expect(isValidStay('2026-11-24', '2026-11-25', now)).toBe(true)
  })

  test('rejects a check-in two days back', () => {
    expect(isValidStay('2026-11-23', '2026-11-24', now)).toBe(false)
  })

  test('rejects zero nights and checkout before checkin', () => {
    expect(isValidStay('2026-11-26', '2026-11-26', now)).toBe(false)
    expect(isValidStay('2026-11-27', '2026-11-26', now)).toBe(false)
  })

  test('caps the stay at 30 nights', () => {
    expect(isValidStay('2026-12-01', '2026-12-31', now)).toBe(true)
    expect(isValidStay('2026-12-01', '2027-01-01', now)).toBe(false)
  })

  test('rejects dates that do not exist or are malformed', () => {
    expect(isValidStay('2026-02-30', '2026-03-02', now)).toBe(false)
    expect(isValidStay('2026-12-1', '2026-12-02', now)).toBe(false)
  })
})
