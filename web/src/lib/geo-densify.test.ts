import { describe, it, expect } from 'vitest'
import { densifyLine } from './geo-densify'

/** Largest gap (m) between consecutive points. */
function maxGapMeters(coords: [number, number][]): number {
  const R = 6371000
  let max = 0
  for (let i = 1; i < coords.length; i++) {
    const [lng1, lat1] = coords[i - 1]
    const [lng2, lat2] = coords[i]
    const dLat = ((lat2 - lat1) * Math.PI) / 180
    const dLng = ((lng2 - lng1) * Math.PI) / 180
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
    max = Math.max(max, 2 * R * Math.asin(Math.sqrt(a)))
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
