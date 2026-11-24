import { describe, expect, test } from 'vitest'
import {
  BROADCAST_HEARTBEAT_MS,
  LOCATION_STALE_AFTER_MS,
  MAX_BROADCAST_BACKOFF_MS,
  STATIONARY_REFRESH_MS,
  broadcastBackoffMs,
  isLocationStale,
  isNewerSample,
  isValidLocationData,
} from './friend-location'

describe('isLocationStale', () => {
  const now = Date.parse('2026-11-24T12:00:00Z')

  test('a stationary sender refreshing on schedule never looks stale', () => {
    expect(LOCATION_STALE_AFTER_MS).toBeGreaterThan(
      STATIONARY_REFRESH_MS + BROADCAST_HEARTBEAT_MS,
    )
    const lastRefresh = new Date(now - STATIONARY_REFRESH_MS - BROADCAST_HEARTBEAT_MS)
    expect(isLocationStale(lastRefresh, now)).toBe(false)
  })

  test('an old sample is stale', () => {
    expect(isLocationStale(new Date(now - LOCATION_STALE_AFTER_MS - 1), now)).toBe(true)
  })
})

describe('isValidLocationData', () => {
  const base = { lat: 35.2, lng: -80.8, timestamp: 1 }

  test('accepts a real coordinate', () => {
    expect(isValidLocationData(base)).toBe(true)
  })

  test.each([
    { ...base, lat: 91 },
    { ...base, lng: -181 },
    { ...base, lat: Number.NaN },
    { ...base, lng: '12' },
    { lat: 1, lng: 1 },
    null,
  ])('rejects %o', (v) => {
    expect(isValidLocationData(v)).toBe(false)
  })
})

describe('isNewerSample', () => {
  const t = new Date('2026-11-24T12:00:00Z')

  test('first sample always applies', () => {
    expect(isNewerSample(undefined, t)).toBe(true)
  })

  test('an older row never replaces a newer one', () => {
    expect(isNewerSample(t, new Date(t.getTime() - 1))).toBe(false)
    expect(isNewerSample(t, new Date(t.getTime() + 1))).toBe(true)
  })

  test('an unparseable timestamp is ignored', () => {
    expect(isNewerSample(t, new Date('nope'))).toBe(false)
  })
})

describe('broadcastBackoffMs', () => {
  test('grows with failures and caps', () => {
    expect(broadcastBackoffMs(0)).toBe(0)
    expect(broadcastBackoffMs(2)).toBeGreaterThan(broadcastBackoffMs(1))
    expect(broadcastBackoffMs(50)).toBe(MAX_BROADCAST_BACKOFF_MS)
  })
})
