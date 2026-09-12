import { describe, it, expect } from 'vitest'
import { distanceToLine, haversineMeters, projectAlong, sliceAlong } from './geo-line'

// A straight west→east line at NYC's latitude, ~842 m per 0.01° of
// longitude. Four vertices, three equal segments.
const LINE: [number, number][] = [
  [-74.00, 40.70],
  [-73.99, 40.70],
  [-73.98, 40.70],
  [-73.97, 40.70],
]
const SEG = haversineMeters(40.70, -74.00, 40.70, -73.99)

describe('projectAlong', () => {
  it('is 0 at the start and the full length at the end', () => {
    expect(projectAlong(LINE, LINE[0])).toBe(0)
    expect(projectAlong(LINE, LINE[3])).toBeCloseTo(SEG * 3, 6)
  })

  it('lands mid-segment for a point beside the line', () => {
    // Just north of the midpoint of the middle segment
    const along = projectAlong(LINE, [-73.985, 40.701])
    expect(along).toBeCloseTo(SEG * 1.5, -1)
  })

  it('clamps a point beyond an end to that end', () => {
    expect(projectAlong(LINE, [-74.02, 40.70])).toBe(0)
    expect(projectAlong(LINE, [-73.95, 40.70])).toBeCloseTo(SEG * 3, 6)
  })
})

describe('sliceAlong', () => {
  it('returns the whole line for the full span', () => {
    const s = sliceAlong(LINE, 0, SEG * 3)
    expect(s.length).toBe(4)
    expect(s[0]).toEqual(LINE[0])
    expect(s[3][0]).toBeCloseTo(LINE[3][0], 9)
  })

  it('interpolates both cut ends exactly', () => {
    const s = sliceAlong(LINE, SEG * 0.5, SEG * 2.5)
    expect(s[0][0]).toBeCloseTo(-73.995, 6)
    expect(s[s.length - 1][0]).toBeCloseTo(-73.975, 6)
    // interior vertices survive
    expect(s).toContainEqual([-73.99, 40.70])
    expect(s).toContainEqual([-73.98, 40.70])
  })

  it('round-trips with projectAlong: slicing between two projected stops ends on them', () => {
    const stopA: [number, number] = [-73.994, 40.7002]
    const stopB: [number, number] = [-73.976, 40.6998]
    const s = sliceAlong(LINE, projectAlong(LINE, stopA), projectAlong(LINE, stopB))
    expect(s[0][0]).toBeCloseTo(stopA[0], 4)
    expect(s[s.length - 1][0]).toBeCloseTo(stopB[0], 4)
  })

  it('clamps a span past the end and rejects an empty one', () => {
    const s = sliceAlong(LINE, SEG * 2, SEG * 99)
    expect(s[s.length - 1][0]).toBeCloseTo(LINE[3][0], 9)
    expect(sliceAlong(LINE, SEG, SEG)).toEqual([])
  })
})

describe('distanceToLine', () => {
  it('is 0 on the line and the perpendicular distance beside it', () => {
    expect(distanceToLine(LINE, [-73.985, 40.70])).toBeCloseTo(0, 6)
    // 0.001° of latitude ≈ 111 m, whatever the longitude
    expect(distanceToLine(LINE, [-73.985, 40.701])).toBeCloseTo(110.5, 0)
  })

  it('measures a point past an end to that end, not to the line through it', () => {
    // Straight off the west end: the perpendicular to the infinite line
    // would be 0, but the line stops here.
    // Equirectangular against haversine: metres apart over a 1.7 km gap.
    expect(distanceToLine(LINE, [-74.02, 40.70])).toBeCloseTo(
      haversineMeters(40.70, -74.02, 40.70, -74.00),
      -1,
    )
  })

  it('falls back to the lone vertex of a degenerate line', () => {
    expect(distanceToLine([[-74.0, 40.70]], [-74.0, 40.701])).toBeCloseTo(111, 0)
    expect(distanceToLine([], [-74.0, 40.70])).toBe(Infinity)
  })
})
