import { describe, expect, test } from 'bun:test'
import { rankAlternatives, type NearbyStation } from './dock-alternatives'

const station = (id: string, lat: number, docks: number, bikes = 5, overrides: Partial<NearbyStation> = {}): NearbyStation => ({
  type: 'station', stationId: id, name: id, lat, lon: 0, numBikesAvailable: bikes, numDocksAvailable: docks,
  isRenting: true, isReturning: true, ...overrides,
})
const original = { lat: 0, lng: 0 }

describe('rankAlternatives', () => {
  test('keeps stations with enough docks, nearest the destination first', () => {
    const stations = [station('original', 0, 0), station('a', 0.004, 6), station('b', 0.002, 8), station('few', 0.001, 1)]
    const ranked = rankAlternatives(stations, original, 'dock', 3, { lat: 0.005, lng: 0 })
    expect(ranked.map(a => a.stationId)).toEqual(['a', 'b'])
  })

  test('without a destination, the nearest to the original wins', () => {
    const ranked = rankAlternatives([station('a', 0.004, 6), station('b', 0.002, 8)], original, 'dock', 3, null)
    expect(ranked[0].stationId).toBe('b')
  })

  test('counts e-bikes as bikes and skips stations not renting', () => {
    const stations = [
      station('ebikes', 0.002, 5, 1, { numEbikesAvailable: 3 }),
      station('closed', 0.001, 5, 9, { isRenting: false }),
    ]
    expect(rankAlternatives(stations, original, 'bike', 3, null).map(a => [a.stationId, a.available])).toEqual([['ebikes', 4]])
  })
})
