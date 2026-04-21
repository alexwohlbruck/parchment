/**
 * Tests for trip → anonymized segment observation conversion.
 *
 * Verifies bucketing math, dedup, clamping, and that output carries no
 * fields beyond (segmentId, speedBucket, timeBucket).
 */

import { describe, test, expect } from 'vitest'
import { bucketObservation, anonymizeTrip } from './trip-aggregates'

describe('bucketObservation', () => {
  test('buckets speed into 10 km/h slots', () => {
    expect(
      bucketObservation({
        segmentId: 's',
        avgSpeedKmh: 0,
        observedAt: Date.UTC(2026, 3, 20, 0), // Monday 00:00 UTC
      }).speedBucket,
    ).toBe(0)
    expect(
      bucketObservation({
        segmentId: 's',
        avgSpeedKmh: 9.9,
        observedAt: Date.UTC(2026, 3, 20, 0),
      }).speedBucket,
    ).toBe(0)
    expect(
      bucketObservation({
        segmentId: 's',
        avgSpeedKmh: 10,
        observedAt: Date.UTC(2026, 3, 20, 0),
      }).speedBucket,
    ).toBe(1)
    expect(
      bucketObservation({
        segmentId: 's',
        avgSpeedKmh: 55.5,
        observedAt: Date.UTC(2026, 3, 20, 0),
      }).speedBucket,
    ).toBe(5)
  })

  test('clamps absurdly-high speeds to the top bucket (49)', () => {
    expect(
      bucketObservation({
        segmentId: 's',
        avgSpeedKmh: 999_999,
        observedAt: Date.UTC(2026, 3, 20, 0),
      }).speedBucket,
    ).toBe(49)
  })

  test('clamps negative speeds to 0', () => {
    expect(
      bucketObservation({
        segmentId: 's',
        avgSpeedKmh: -10,
        observedAt: Date.UTC(2026, 3, 20, 0),
      }).speedBucket,
    ).toBe(0)
  })

  test('time bucket is hour-of-week in UTC', () => {
    // Sunday 2026-04-19 00:00 UTC → dayOfWeek=0, hour=0 → bucket 0
    expect(
      bucketObservation({
        segmentId: 's',
        avgSpeedKmh: 30,
        observedAt: Date.UTC(2026, 3, 19, 0, 0, 0),
      }).timeBucket,
    ).toBe(0)

    // Monday 15:00 UTC → day=1, hour=15 → 1*24+15 = 39
    expect(
      bucketObservation({
        segmentId: 's',
        avgSpeedKmh: 30,
        observedAt: Date.UTC(2026, 3, 20, 15, 0, 0),
      }).timeBucket,
    ).toBe(39)

    // Saturday 23:00 UTC → day=6, hour=23 → 167 (max valid)
    expect(
      bucketObservation({
        segmentId: 's',
        avgSpeedKmh: 30,
        observedAt: Date.UTC(2026, 3, 25, 23, 0, 0),
      }).timeBucket,
    ).toBe(167)
  })

  test('throws on NaN observedAt', () => {
    expect(() =>
      bucketObservation({
        segmentId: 's',
        avgSpeedKmh: 30,
        observedAt: Number.NaN,
      }),
    ).toThrow()
  })
})

describe('anonymizeTrip', () => {
  test('emits only segmentId, speedBucket, timeBucket per record', () => {
    const out = anonymizeTrip([
      {
        segmentId: 'seg-1',
        avgSpeedKmh: 45,
        observedAt: Date.UTC(2026, 3, 20, 15),
      },
    ])
    expect(Object.keys(out[0]).sort()).toEqual([
      'segmentId',
      'speedBucket',
      'timeBucket',
    ])
  })

  test('dedupes identical (segmentId, speedBucket, timeBucket) triples', () => {
    const base = {
      segmentId: 'seg-1',
      avgSpeedKmh: 45,
      observedAt: Date.UTC(2026, 3, 20, 15),
    }
    const out = anonymizeTrip([base, { ...base }, { ...base, avgSpeedKmh: 46 }])
    expect(out.length).toBe(1) // 45 and 46 both round to bucket 4
  })

  test('drops observations with empty segmentId', () => {
    const out = anonymizeTrip([
      {
        segmentId: '',
        avgSpeedKmh: 45,
        observedAt: Date.UTC(2026, 3, 20, 15),
      },
    ])
    expect(out.length).toBe(0)
  })

  test('shuffles output — successive calls on the same input can differ', () => {
    // Construct 50 unique entries; probability of identical shuffle is
    // astronomical, so 100 attempts are plenty to see differing orders.
    const input = Array.from({ length: 50 }, (_, i) => ({
      segmentId: `seg-${i}`,
      avgSpeedKmh: 20,
      observedAt: Date.UTC(2026, 3, 20, 15),
    }))
    const a = anonymizeTrip(input)
      .map((o) => o.segmentId)
      .join(',')
    let sawDifferent = false
    for (let i = 0; i < 20; i++) {
      const b = anonymizeTrip(input)
        .map((o) => o.segmentId)
        .join(',')
      if (a !== b) {
        sawDifferent = true
        break
      }
    }
    expect(sawDifferent).toBe(true)
  })
})
