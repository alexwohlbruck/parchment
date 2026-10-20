import { describe, expect, it } from 'vitest'
import { dayNightOpacity, globeSunDirection } from './daynight'
import { subSolarPoint, sunPosition } from '@/lib/map/sun-position'

describe('solar globe coordinates', () => {
  it('places the overhead sun at the seasonal latitude', () => {
    for (const [date, latitude] of [
      ['2026-03-20T12:00:00Z', 0],
      ['2026-06-21T12:00:00Z', 23.44],
      ['2026-12-21T12:00:00Z', -23.44],
    ] as const) {
      const point = subSolarPoint(new Date(date))
      expect(point.lat).toBeCloseTo(latitude, 0)
      expect(Math.abs(point.lng)).toBeLessThan(3)
      expect(sunPosition(new Date(date), point.lat, point.lng).altitude).toBeCloseTo(Math.PI / 2, 6)
    }
  })

  it('matches local solar altitude in MapLibre sphere coordinates', () => {
    for (const date of ['2026-06-21T12:00:00Z', '2026-12-21T23:00:00Z']) {
      const sun = globeSunDirection(new Date(date))
      expect(Math.hypot(...sun)).toBeCloseTo(1, 10)
      for (const [latitude, longitude] of [[40.71, -74], [-33.87, 151.21], [80, 0], [-20, -170]]) {
        const lat = latitude * Math.PI / 180
        const lng = longitude * Math.PI / 180
        const cosine = sun[0] * Math.cos(lat) * Math.sin(lng) + sun[1] * Math.sin(lat) + sun[2] * Math.cos(lat) * Math.cos(lng)
        expect(Math.asin(cosine)).toBeCloseTo(sunPosition(new Date(date), latitude, longitude).altitude, 8)
      }
    }
  })
})

describe('day/night raster handoff', () => {
  it('suppresses the raster over the globe and restores it for closer views', () => {
    const globe = dayNightOpacity(true)
    const flat = dayNightOpacity(false)
    expect(globe.slice(3, 7)).toEqual([0, 0, 4, 0])
    expect(flat.slice(3, 7)).toEqual([0, 1, 4, 0.8])
    expect(globe.slice(7)).toEqual(flat.slice(7))
  })
})
