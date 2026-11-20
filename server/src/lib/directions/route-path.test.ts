import { describe, expect, test } from 'bun:test'
import { pathFromTrip } from './route-path'

describe('pathFromTrip', () => {
  test('joins nested legs into one path, keeping elevation and the trip totals', () => {
    const path = pathFromTrip({
      segments: [
        {
          mode: 'walking',
          geometry: [{ lat: 1, lng: 2, elevation: 10 }, { lat: 1.1, lng: 2.1, elevation: 12 }],
          distance: 100,
          duration: 60,
          totalElevationGain: 2,
        },
        {
          mode: 'biking',
          details: {
            multimodalSegments: [
              { mode: 'biking', geometry: [{ lat: 1.2, lng: 2.2 }], distance: 900, duration: 240 },
            ],
          },
          totalElevationGain: 30,
          totalElevationLoss: 5,
        },
      ],
      tripStats: { totalDistance: 1000, totalDuration: 300 },
    })
    expect(path.geometry).toEqual([[2, 1], [2.1, 1.1], [2.2, 1.2]])
    expect(path.elevation).toEqual([10, 12, 0])
    expect(path.segments.map((segment) => segment.mode)).toEqual(['walking', 'biking'])
    expect(path.stats).toEqual({ distance: 1000, duration: 300, elevationGain: 32, elevationLoss: 5 })
  })

  test('leaves elevation out when the engine gave none', () => {
    const path = pathFromTrip({ segments: [{ mode: 'biking', geometry: [{ lat: 1, lng: 2 }] }] })
    expect(path.elevation).toBeUndefined()
    expect(path.stats).toEqual({ distance: 0, duration: 0, elevationGain: undefined, elevationLoss: undefined })
  })
})
