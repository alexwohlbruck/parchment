import { describe, expect, test } from 'bun:test'
import { isShareActive } from './location-share'

const now = new Date('2026-11-25T12:00:00Z')

describe('isShareActive', () => {
  test('an open-ended share stays active', () => {
    expect(isShareActive({ enabled: true, expiresAt: null }, now)).toBe(true)
  })

  test('a share is active until its expiry', () => {
    const expiresAt = new Date('2026-11-25T12:00:01Z')
    expect(isShareActive({ enabled: true, expiresAt }, now)).toBe(true)
  })

  test('a share ends at the instant it expires', () => {
    expect(isShareActive({ enabled: true, expiresAt: now }, now)).toBe(false)
  })

  test('a past expiry ends the share', () => {
    const expiresAt = new Date('2026-11-25T11:00:00Z')
    expect(isShareActive({ enabled: true, expiresAt }, now)).toBe(false)
  })

  test('a disabled share is inactive whatever its expiry', () => {
    expect(isShareActive({ enabled: false, expiresAt: null }, now)).toBe(false)
  })
})
