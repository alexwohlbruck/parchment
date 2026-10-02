import { describe, it, expect } from 'vitest'
import { boundsOfPoints } from './map-bounds'

describe('boundsOfPoints', () => {
  it('boxes every point', () => {
    expect(
      boundsOfPoints([
        { lat: 35, lng: -80 },
        { lat: 36, lng: -81 },
        { lat: 35.5, lng: -79 },
      ]),
    ).toEqual({ minLat: 35, minLng: -81, maxLat: 36, maxLng: -79 })
  })

  it('ignores points without coordinates', () => {
    expect(
      boundsOfPoints([{ lat: 35, lng: -80 }, { lat: NaN, lng: 0 }]),
    ).toEqual({ minLat: 35, minLng: -80, maxLat: 35, maxLng: -80 })
  })

  it('returns null for nothing to box', () => {
    expect(boundsOfPoints([])).toBeNull()
  })
})
