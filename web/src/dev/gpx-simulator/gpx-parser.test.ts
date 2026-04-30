import { describe, expect, test } from 'vitest'
import { parseGpx, pointAtTime, trackDurationSec } from './gpx-parser'

const minimalGpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test">
  <trk><trkseg>
    <trkpt lat="35.21" lon="-80.82">
      <ele>200</ele>
      <time>2026-04-28T12:00:00.000Z</time>
    </trkpt>
    <trkpt lat="35.21" lon="-80.81">
      <ele>200</ele>
      <time>2026-04-28T12:01:00.000Z</time>
    </trkpt>
    <trkpt lat="35.21" lon="-80.80">
      <ele>200</ele>
      <time>2026-04-28T12:02:00.000Z</time>
    </trkpt>
  </trkseg></trk>
</gpx>`

describe('parseGpx', () => {
  test('extracts <trkpt> coordinates and timestamps', () => {
    const points = parseGpx(minimalGpx)
    expect(points).toHaveLength(3)
    expect(points[0].lat).toBeCloseTo(35.21, 5)
    expect(points[0].lng).toBeCloseTo(-80.82, 5)
    expect(points[0].altitude).toBe(200)
    expect(points[0].time).toBe(
      new Date('2026-04-28T12:00:00.000Z').getTime(),
    )
  })

  test('synthesizes speed from successive points', () => {
    const points = parseGpx(minimalGpx)
    // 0.01° lng @ 35.21° lat ≈ 909m. 60s gap → ~15 m/s.
    expect(points[0].speed).toBeGreaterThan(10)
    expect(points[0].speed).toBeLessThan(20)
    // Last point has no successor — speed = 0.
    expect(points[2].speed).toBe(0)
  })

  test('synthesizes heading (east is ~90°)', () => {
    const points = parseGpx(minimalGpx)
    expect(points[0].heading).not.toBeNull()
    expect(points[0].heading!).toBeGreaterThan(85)
    expect(points[0].heading!).toBeLessThan(95)
    // Last point: no heading.
    expect(points[2].heading).toBeNull()
  })

  test('throws on no <trkpt>', () => {
    const empty = `<?xml version="1.0"?><gpx></gpx>`
    expect(() => parseGpx(empty)).toThrow(/No <trkpt>/)
  })

  test('synthesizes 1Hz timestamps when none in file', () => {
    const noTime = `<?xml version="1.0"?>
      <gpx><trk><trkseg>
        <trkpt lat="0" lon="0"/>
        <trkpt lat="0" lon="0.001"/>
      </trkseg></trk></gpx>`
    const points = parseGpx(noTime)
    expect(points[1].time - points[0].time).toBe(1000)
  })

  test('drops malformed coordinates', () => {
    const partial = `<?xml version="1.0"?>
      <gpx><trk><trkseg>
        <trkpt lat="not-a-number" lon="0"/>
        <trkpt lat="0" lon="0.001"/>
      </trkseg></trk></gpx>`
    const points = parseGpx(partial)
    expect(points).toHaveLength(1)
  })
})

describe('trackDurationSec', () => {
  test('returns total span across all points', () => {
    const points = parseGpx(minimalGpx)
    expect(trackDurationSec(points)).toBe(120)
  })

  test('returns 0 for single point', () => {
    const single = `<?xml version="1.0"?>
      <gpx><trk><trkseg>
        <trkpt lat="0" lon="0"><time>2026-04-28T12:00:00Z</time></trkpt>
      </trkseg></trk></gpx>`
    const points = parseGpx(single)
    expect(trackDurationSec(points)).toBe(0)
  })
})

describe('pointAtTime', () => {
  const points = parseGpx(minimalGpx)
  const t0 = points[0].time

  test('returns first point at or before track start', () => {
    expect(pointAtTime(points, t0 - 1000)).toBe(points[0])
    expect(pointAtTime(points, t0)).toBe(points[0])
  })

  test('returns last point at or after track end', () => {
    expect(pointAtTime(points, t0 + 999_999)).toBe(points[2])
  })

  test('returns the latest point with time <= target', () => {
    // 30s in: still on point 0
    expect(pointAtTime(points, t0 + 30_000)).toBe(points[0])
    // 60s in: on point 1 exactly
    expect(pointAtTime(points, t0 + 60_000)).toBe(points[1])
    // 90s in: still on point 1
    expect(pointAtTime(points, t0 + 90_000)).toBe(points[1])
    // 120s in: on point 2
    expect(pointAtTime(points, t0 + 120_000)).toBe(points[2])
  })
})
