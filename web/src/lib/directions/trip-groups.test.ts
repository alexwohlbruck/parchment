import { describe, expect, it } from 'vitest'
import { groupByTripType } from './trip-groups'

const walk = { mode: 'walking', duration: 120 }
const bike = { mode: 'cycling', duration: 600 }
const train = { mode: 'transit', duration: 900 }

const trip = (id: string, rank: number, segments: { mode: string; duration: number }[]) =>
  ({ id, rank, segments })

describe('groupByTripType', () => {
  it('orders groups by their best trip and keeps rank order inside each', () => {
    const groups = groupByTripType([
      trip('walkTransit', 3, [walk, train, walk]),
      trip('bikeTransit', 1, [bike, train, walk]),
      trip('cycling', 4, [bike]),
      trip('bikeTransitLater', 2, [bike, train, bike]),
      trip('walkTransitLater', 5, [walk, train, walk]),
    ])

    expect(groups.map(g => [g.key, g.trips.map(t => t.id)])).toEqual([
      ['transitBike', ['bikeTransit', 'bikeTransitLater']],
      ['transit', ['walkTransit', 'walkTransitLater']],
      ['cycling', ['cycling']],
    ])
  })

  it('returns nothing for no trips', () => {
    expect(groupByTripType([])).toEqual([])
  })
})
