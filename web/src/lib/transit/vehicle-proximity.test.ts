import { describe, test, expect } from 'vitest'
import { vehicleProximity } from '@/lib/transit/vehicle-proximity'

const bus = (vehicleId: string, lat: number, lng: number) => ({
  vehicleId,
  vehicle: { position: { lat, lng } },
})

describe('vehicleProximity', () => {
  const buses = [
    bus('south', 40.7033, -74.0116),
    bus('midtown', 40.7488, -73.9718),
    bus('harlem', 40.8007, -73.9333),
  ]

  test('picks the bus nearest the user', () => {
    const { closestId } = vehicleProximity(buses, { lat: 40.7527, lng: -73.9772 })
    expect(closestId).toBe('midtown')
  })

  test('measures every bus', () => {
    const { distances } = vehicleProximity(buses, { lat: 40.7033, lng: -74.0116 })
    expect(distances.get('south')).toBe(0)
    expect(distances.get('harlem')).toBeGreaterThan(10_000)
  })

  test('has nothing to say without a location', () => {
    expect(vehicleProximity(buses, null)).toEqual({ distances: new Map(), closestId: null })
  })
})
