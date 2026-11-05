import { describe, test, expect } from 'vitest'
import {
  alongTrack,
  arrivalSpeed,
  correctionFor,
  fixConfidence,
  HIGH_CONFIDENCE,
  LOW_CONFIDENCE,
  MAX_HOLD_M,
  measuredSpeed,
  nextSpeed,
  pushFix,
  signedProgress,
  type PathFix,
} from '@/lib/transit/vehicle-motion'

const at = (...pairs: [number, number][]): PathFix[] =>
  pairs.map(([dist, sec]) => ({ dist, timestampMs: sec * 1000 }))

describe('fixConfidence', () => {
  test('does not coast on a first sample', () => {
    expect(fixConfidence([])).toBe(0)
    expect(fixConfidence(at([0, 0]))).toBe(0)
  })

  test('stays low until three fixes can be compared', () => {
    expect(fixConfidence(at([0, 0], [50, 5]))).toBe(LOW_CONFIDENCE)
  })

  test('trusts three fixes moving forward at a similar speed', () => {
    expect(fixConfidence(at([0, 0], [50, 5], [95, 10]))).toBe(HIGH_CONFIDENCE)
  })

  test('distrusts fixes whose speed jumps', () => {
    expect(fixConfidence(at([0, 0], [10, 5], [90, 10]))).toBe(LOW_CONFIDENCE)
  })

  test('distrusts fixes that step backwards', () => {
    expect(fixConfidence(at([0, 0], [50, 5], [40, 10]))).toBe(LOW_CONFIDENCE)
  })

  test('judges only the latest three fixes', () => {
    expect(fixConfidence(at([500, 0], [0, 5], [50, 10], [100, 15]))).toBe(HIGH_CONFIDENCE)
  })
})

describe('measuredSpeed', () => {
  test('reads the last step', () => {
    expect(measuredSpeed(at([0, 0], [50, 5], [80, 10]))).toBe(6)
  })

  test('never goes negative', () => {
    expect(measuredSpeed(at([50, 0], [40, 5]))).toBe(0)
  })

  test('ignores fixes too close in time', () => {
    expect(measuredSpeed(at([0, 0], [5, 0.5]))).toBeNull()
  })
})

describe('arrivalSpeed', () => {
  test('times the remaining distance from the fix, not from now', () => {
    expect(arrivalSpeed(300, 1_000, 31_000)).toBe(10)
  })

  test('gives up when the arrival is imminent or the stop is behind', () => {
    expect(arrivalSpeed(300, 0, 1_000)).toBeNull()
    expect(arrivalSpeed(0, 0, 30_000)).toBeNull()
  })
})

describe('nextSpeed', () => {
  const base = { previous: 10, measured: 20, feedReportsSpeed: true, maxSpeed: 25 }

  test('prefers the arrival prediction over GPS deltas', () => {
    expect(nextSpeed({ ...base, arrival: 5 })).toBeCloseTo(7)
  })

  test('smooths GPS deltas into the previous speed', () => {
    expect(nextSpeed({ ...base, arrival: null })).toBeCloseTo(13)
  })

  test('caps at the mode limit', () => {
    expect(nextSpeed({ ...base, arrival: 100 })).toBe(25)
  })
})

describe('correctionFor', () => {
  test('glides toward a fix ahead', () => {
    expect(correctionFor(30)).toBe('glide')
  })

  test('holds rather than reversing toward a fix behind', () => {
    expect(correctionFor(-40)).toBe('hold')
  })

  test('jumps to a fix too far behind to wait for', () => {
    expect(correctionFor(-MAX_HOLD_M - 1)).toBe('jump')
  })
})

describe('free-space fixes', () => {
  const north = (m: number, sec: number) => ({
    lngLat: { lat: m / 111_195, lng: 0 },
    timestampMs: sec * 1000,
  })

  test('signedProgress is negative for a point behind the heading', () => {
    expect(signedProgress(north(100, 0).lngLat, north(0, 0).lngLat, 0)).toBeCloseTo(-100, 0)
  })

  test('alongTrack reads a straight run as steady progress', () => {
    const fixes = alongTrack([north(0, 0), north(50, 5), north(100, 10)])
    expect(fixes.map((f) => Math.round(f.dist))).toEqual([0, 50, 100])
    expect(fixConfidence(fixes)).toBe(HIGH_CONFIDENCE)
  })

  test('pushFix keeps only the history confidence needs', () => {
    let history = [north(0, 0)]
    for (let i = 1; i < 6; i++) history = pushFix(history, north(i * 10, i))
    expect(history).toHaveLength(3)
    expect(history[0].timestampMs).toBe(3000)
  })
})
