import { describe, test, expect } from 'vitest'
import { solarRow, solarRows } from './solar'
import { headingToBearing } from './furniture'

const square = (w: number, s: number, e: number, n: number) => ({
  type: 'Polygon',
  coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
})
const everywhere = { minX: 0, minY: 0, maxX: 1, maxY: 1 }
// About 270 m east-west by 220 m north-south.
const field = square(-80.85, 35.2, -80.847, 35.202)

describe('solar rows', () => {
  test('lays each row as a few long slabs rather than one object per table', () => {
    const rows = solarRows(field, everywhere)
    const lats = new Set(rows.map(r => r.lat))
    expect(lats.size).toBeGreaterThan(25)
    expect(lats.size).toBeLessThan(40)
    expect(rows.length).toBeLessThanOrEqual(lats.size * 15)
    for (const r of rows) expect(r.length).toBeLessThanOrEqual(24)
  })

  test('segments fill each row to within its inset of the edges', () => {
    const rows = solarRows(field, everywhere)
    const lat = rows[0].lat
    const total = rows.filter(r => r.lat === lat).reduce((t, r) => t + r.length, 0)
    const width = 0.003 * 111320 * Math.cos((lat * Math.PI) / 180)
    expect(total).toBeGreaterThan(width - 4)
    expect(total).toBeLessThan(width)
  })

  test('a field split across tiles is laid once', () => {
    const whole = solarRows(field, everywhere)
    const mid = (-80.8485 + 180) / 360
    const west = solarRows(field, { ...everywhere, maxX: mid })
    const east = solarRows(field, { ...everywhere, minX: mid })
    const length = (rows: typeof whole) => rows.reduce((t, r) => t + r.length, 0)
    expect(length(west) + length(east)).toBeCloseTo(length(whole), -1)
    expect(new Set([...west, ...east].map(r => r.lat)).size).toBe(new Set(whole.map(r => r.lat)).size)
  })

  test('rows lean with the ground across a whole row pitch', () => {
    const row = solarRow({ lng: -80, lat: 35, length: 18 })
    expect(row.conform).toEqual({ across: 8 })
    expect(row.length).toBe(18)
  })

  test('rows face the equator in either hemisphere', () => {
    expect(headingToBearing(solarRow({ lng: -80, lat: 35, length: 20 }).heading)).toBeCloseTo(180, 6)
    expect(headingToBearing(solarRow({ lng: 150, lat: -33, length: 20 }).heading)).toBeCloseTo(0, 6)
  })
})
