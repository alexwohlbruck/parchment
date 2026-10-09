import { describe, test, expect } from 'vitest'
import { solarRow, solarRows } from './solar'
import { buildExclusions, MERCATOR_METRE } from './planting'
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

  test('rows break around a road through the field, keeping its clearance', () => {
    const road = { properties: { class: 'service' }, geometry: { type: 'LineString', coordinates: [[-80.8485, 35.199], [-80.8485, 35.203]] } }
    const rows = solarRows(field, everywhere, buildExclusions([road], []))
    const roadX = (-80.8485 + 180) / 360
    const gap = 6 * MERCATOR_METRE
    for (const r of rows) {
      const half = r.length / 2 / (2 * Math.PI * 6371008.8 * Math.cos((r.lat * Math.PI) / 180))
      const x = (r.lng + 180) / 360
      expect(x + half < roadX - gap + 1e-9 || x - half > roadX + gap - 1e-9).toBe(true)
    }
    expect(new Set(rows.map(r => r.lat)).size).toBe(new Set(solarRows(field, everywhere).map(r => r.lat)).size)
  })

  test('rows leave out buildings inside the field', () => {
    const shed = { geometry: square(-80.8487, 35.2008, -80.8483, 35.2012) }
    const lat = 35.201
    const near = (rows: ReturnType<typeof solarRows>) => rows.filter(r => Math.abs(r.lat - lat) < 0.0002 && Math.abs(r.lng + 80.8485) < 0.0002)
    expect(near(solarRows(field, everywhere)).length).toBeGreaterThan(0)
    expect(near(solarRows(field, everywhere, buildExclusions([], [shed])))).toHaveLength(0)
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
