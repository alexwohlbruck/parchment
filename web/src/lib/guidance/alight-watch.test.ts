import { describe, expect, test } from 'vitest'
import { AlightWatch, AT_STOP_MS, OFF_LINE_MS, offLineNear, WALKING_MS } from './alight-watch'

const T = 1_000_000
const quiet = { alighting: false, offLine: false, walking: false }

function run(watch: AlightWatch, signals: Partial<typeof quiet>, fromMs: number, forMs: number): number | null {
  for (let t = fromMs; t <= fromMs + forMs; t += 1000) {
    if (watch.update({ ...quiet, ...signals, nowMs: t })) return t - fromMs
  }
  return null
}

describe('offLineNear', () => {
  const fix = (over = {}) => ({ t: T, s: 2250, accuracy: 10, offset: 120, ...over })

  test('a precise fix well off the line beside the alighting stop', () => {
    expect(offLineNear(fix(), 1.3, 2300, T + 2000)).toBe(true)
  })

  test('not on the line, not far along it, not fast, not coarse, not stale', () => {
    expect(offLineNear(fix({ offset: 30 }), 1.3, 2300, T)).toBe(false)
    expect(offLineNear(fix({ s: 1500 }), 1.3, 2300, T)).toBe(false)
    expect(offLineNear(fix(), 12, 2300, T)).toBe(false)
    expect(offLineNear(fix({ accuracy: 300 }), 1.3, 2300, T)).toBe(false)
    expect(offLineNear(fix(), 1.3, 2300, T + 30_000)).toBe(false)
    expect(offLineNear(null, null, 2300, T)).toBe(false)
  })
})

describe('AlightWatch', () => {
  test('off the line beside the stop for a few seconds is off the vehicle', () => {
    expect(run(new AlightWatch(), { offLine: true }, T, 20_000)).toBe(OFF_LINE_MS)
  })

  test('walking counts only at the stop', () => {
    expect(run(new AlightWatch(), { walking: true }, T, 60_000)).toBeNull()
    expect(run(new AlightWatch(), { alighting: true, walking: true }, T, 20_000)).toBe(WALKING_MS)
  })

  test('a long stand at the confirmed stop moves on by itself', () => {
    expect(run(new AlightWatch(), { alighting: true }, T, 120_000)).toBe(AT_STOP_MS)
  })

  test('a break in the signal starts the count again', () => {
    const watch = new AlightWatch()
    expect(run(watch, { offLine: true }, T, OFF_LINE_MS - 2000)).toBeNull()
    watch.update({ ...quiet, nowMs: T + OFF_LINE_MS })
    expect(run(watch, { offLine: true }, T + OFF_LINE_MS + 1000, OFF_LINE_MS - 2000)).toBeNull()
  })
})
