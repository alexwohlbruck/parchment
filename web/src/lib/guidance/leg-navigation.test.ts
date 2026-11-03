import { describe, expect, test } from 'vitest'
import type { TripOption } from '@/types/directions.types'
import { isLegNavigable, nextNavigableLeg } from './leg-navigation'

const geometry = [{ lat: 40.71, lng: -74 }, { lat: 40.72, lng: -74 }]
const ride = { mode: 'transit', distance: 1000, geometry }
const transfer = { mode: 'walking', distance: 0, duration: 360, geometry: [] }
const trip = (segments: unknown[]) => ({ segments }) as TripOption

describe('leg navigation', () => {
  test('starts a transit leg with a stationary timed transfer', () => {
    const option = trip([ride, transfer, ride])
    expect(isLegNavigable(option, 0)).toBe(true)
    expect(nextNavigableLeg(option, -1)).toBe(0)
    expect(nextNavigableLeg(option, 0)).toBeNull()
  })

  test('rejects missing shapes for travel between stations', () => {
    expect(isLegNavigable(trip([ride, { ...transfer, distance: 300 }, ride]), 0)).toBe(false)
    expect(isLegNavigable(trip([{ ...ride, geometry: [] }]), 0)).toBe(false)
  })

  test('requires a stationary walk to be between transit rides', () => {
    expect(isLegNavigable(trip([transfer, ride]), 0)).toBe(false)
    expect(isLegNavigable(trip([ride, transfer]), 0)).toBe(false)
    expect(isLegNavigable(trip([transfer]), 0)).toBe(false)
    expect(isLegNavigable(trip([]), 0)).toBe(false)
  })

  test('selects later navigable legs independently', () => {
    const option = trip([
      { ...ride, geometry: [], legIndex: 0 },
      ...[ride, transfer, ride].map(s => ({ ...s, legIndex: 1 })),
    ])
    expect(nextNavigableLeg(option, -1)).toBe(1)
    expect(nextNavigableLeg(option, 1)).toBeNull()
  })

  test('keeps ordinary walking and biking trips navigable', () => {
    for (const mode of ['walking', 'biking']) {
      expect(isLegNavigable(trip([{ mode, distance: 1000, geometry }]), 0)).toBe(true)
    }
  })
})
