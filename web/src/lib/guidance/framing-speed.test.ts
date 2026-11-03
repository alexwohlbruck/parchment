import { describe, expect, test } from 'vitest'
import { createFramingSpeed, holdZoom, stepFramingSpeed, ZOOM_DEAD_BAND } from './framing-speed'

const MPH = 0.44704
const FRAME_SEC = 1 / 30

/** Runs a speed series (mph by second) through at frame rate; returns the framed speed each frame. */
function run(mphAt: (sec: number) => number, seconds: number): number[] {
  const state = createFramingSpeed()
  const out: number[] = []
  for (let t = 0; t <= seconds; t += FRAME_SEC) out.push(stepFramingSpeed(state, mphAt(t) * MPH, t))
  return out
}

const changes = (series: number[]) => series.filter((v, i) => i > 0 && v !== series[i - 1]).length

/** Deterministic jitter in [-1, 1]. */
const noise = (t: number) => Math.sin(t * 2.3) * 0.6 + Math.sin(t * 7.1 + 1) * 0.4

describe('stepFramingSpeed', () => {
  test('14 ± 3 mph of wobble frames one steady speed', () => {
    expect(changes(run(t => 14 + 3 * noise(t), 120))).toBe(0)
  })

  test('slow drift of a few mph over minutes stays put', () => {
    expect(changes(run(t => 14 + 3 * Math.sin(t / 20), 240))).toBe(0)
  })

  test('a sustained 12 → 30 mph change moves the framing once', () => {
    const series = run(t => (t < 20 ? 12 : 30) + 2 * noise(t), 60)
    expect(changes(series)).toBe(1)
    expect(series.at(-1)! > series[0]).toBe(true)
  })

  test('speeding up is followed sooner than slowing down', () => {
    const lag = (from: number, to: number) => {
      const series = run(t => (t < 10 ? from : to), 30)
      return series.findIndex((v, i) => i > 0 && v !== series[i - 1]) * FRAME_SEC - 10
    }
    expect(lag(12, 30)).toBeLessThan(lag(30, 12))
  })

  test('a brief burst does not move the framing', () => {
    expect(changes(run(t => (t > 10 && t < 11.5 ? 30 : 14), 30))).toBe(0)
  })
})

describe('holdZoom', () => {
  test('ignores retargets inside the dead band', () => {
    expect(holdZoom(16, 16 + ZOOM_DEAD_BAND / 2, false)).toBe(16)
    expect(holdZoom(16, 16.5, false)).toBe(16.5)
    expect(holdZoom(null, 15.9, false)).toBe(15.9)
  })

  test('a maneuver drives the zoom continuously', () => {
    expect(holdZoom(16, 16.05, true)).toBe(16.05)
  })
})
