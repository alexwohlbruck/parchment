import { describe, test, expect } from 'bun:test'
import { haversineMeters } from './geometry-conversion'

describe('haversineMeters', () => {
  const charlotte = { lat: 35.2271, lng: -80.8431 }
  const raleigh = { lat: 35.7796, lng: -78.6382 }
  const between = (a: typeof charlotte, b: typeof charlotte) =>
    haversineMeters(a.lat, a.lng, b.lat, b.lng)

  test('same point returns 0', () => {
    expect(between(charlotte, charlotte)).toBe(0)
  })

  test('Charlotte to Raleigh is about 209 km', () => {
    const dist = between(charlotte, raleigh)
    expect(dist).toBeGreaterThan(204_000)
    expect(dist).toBeLessThan(214_000)
  })

  test('half a kilometre north is about 500 m', () => {
    const dist = between(charlotte, { lat: 35.2316, lng: -80.8431 })
    expect(dist).toBeGreaterThan(400)
    expect(dist).toBeLessThan(600)
  })

  test('is symmetric', () => {
    expect(between(charlotte, raleigh)).toBeCloseTo(between(raleigh, charlotte), 6)
  })
})
