import { describe, expect, it } from 'vitest'
import {
  formatCameraReadout,
  formatCameraReadoutText,
  resolveMapCenter,
} from './map-camera'

describe('resolveMapCenter', () => {
  it('reads arrays and lng/lat or lon/lat objects', () => {
    expect(resolveMapCenter([1, 2])).toEqual([1, 2])
    expect(resolveMapCenter({ lng: 3, lat: 4 })).toEqual([3, 4])
    expect(resolveMapCenter({ lon: 5, lat: 6 })).toEqual([5, 6])
  })

  it('falls back to the origin for anything else', () => {
    expect(resolveMapCenter(null)).toEqual([0, 0])
  })
})

describe('formatCameraReadout', () => {
  const camera = {
    center: { lng: -74.0059731, lat: 40.7127753 },
    zoom: 14.5234,
    pitch: 45,
    bearing: -17.345,
  }

  it('orders coordinates lat, lng and rounds each field', () => {
    expect(formatCameraReadout(camera)).toEqual({
      coordinates: '40.71278, -74.00597',
      zoom: '14.52',
      pitch: '45.0°',
      bearing: '-17.3°',
    })
  })

  it('joins the fields into one copyable line', () => {
    expect(formatCameraReadoutText(camera)).toBe(
      '40.71278, -74.00597 · z 14.52 · pitch 45.0° · bearing -17.3°',
    )
  })
})
