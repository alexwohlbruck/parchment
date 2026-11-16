import { describe, it, expect } from 'vitest'
import { distance } from '@turf/turf'
import { densifyLine } from './geo-densify'

/** Largest gap (m) between consecutive points. */
function maxGapMeters(coords: [number, number][]): number {
  let max = 0
  for (let i = 1; i < coords.length; i++) {
    max = Math.max(max, distance(coords[i - 1], coords[i], { units: 'meters' }))
  }
  return max
}

describe('densifyLine', () => {
  it('breaks a 1.5km gap into sub-threshold segments', () => {
    // Two points ~1.3km apart (the W line tunnel-crossing gap).
    const sparse: [number, number][] = [
      [-73.946938, 40.753765],
      [-73.959131, 40.75923],
    ]
    expect(maxGapMeters(sparse)).toBeGreaterThan(1000)
    const dense = densifyLine(sparse, 120)
    expect(maxGapMeters(dense)).toBeLessThanOrEqual(120)
    // Endpoints are preserved exactly
    expect(dense[0]).toEqual(sparse[0])
    expect(dense[dense.length - 1]).toEqual(sparse[1])
  })

  it('keeps interpolated points collinear (path unchanged)', () => {
    const line: [number, number][] = [[0, 0], [0, 0.02]] // ~2.2km due north
    const dense = densifyLine(line, 200)
    // All intermediate points share longitude 0 (straight line preserved)
    expect(dense.every((p) => p[0] === 0)).toBe(true)
    expect(dense.length).toBeGreaterThan(2)
  })

  it('leaves an already-dense line untouched', () => {
    const dense: [number, number][] = [
      [-73.98, 40.76],
      [-73.9801, 40.7601],
      [-73.9802, 40.7602],
    ]
    expect(densifyLine(dense, 120)).toEqual(dense)
  })

  it('handles degenerate input', () => {
    expect(densifyLine([], 120)).toEqual([])
    expect(densifyLine([[1, 2]], 120)).toEqual([[1, 2]])
  })
})
