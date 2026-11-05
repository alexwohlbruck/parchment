import { describe, test, expect } from 'bun:test'
import { activeExclusions, dropExcludedTrips, segmentModeToken } from './excluded-modes'
import type { TripSegment } from '../../types/trip.types'

const seg = (mode: TripSegment['mode'], ownership?: TripSegment['ownership']) => ({ mode, ownership })
const trip = (...segments: Array<ReturnType<typeof seg>>) => ({ segments: segments as TripSegment[] })

describe('activeExclusions', () => {
  test('exempts the selected tab mode', () => {
    expect(activeExclusions(['driving', 'transit'], 'driving')).toEqual(new Set(['transit']))
    expect(activeExclusions(['biking', 'bikeshare'], 'biking')).toEqual(new Set(['bikeshare']))
  })

  test('keeps every exclusion on the multi and walking tabs', () => {
    expect(activeExclusions(['driving', 'rideshare'], 'multi')).toEqual(new Set(['driving', 'rideshare']))
    expect(activeExclusions(['transit'], 'walking')).toEqual(new Set(['transit']))
  })

  test('is empty without exclusions', () => {
    expect(activeExclusions(undefined, 'multi').size).toBe(0)
  })
})

describe('segmentModeToken', () => {
  test('counts a shared bike as bikeshare and an owned one as biking', () => {
    expect(segmentModeToken(seg('biking', 'shared'))).toBe('bikeshare')
    expect(segmentModeToken(seg('biking'))).toBe('biking')
    expect(segmentModeToken(seg('biking', 'personal'))).toBe('biking')
  })

  test('never excludes walking', () => {
    expect(segmentModeToken(seg('walking'))).toBeNull()
  })
})

describe('dropExcludedTrips', () => {
  const walk = trip(seg('walking'))
  const subway = trip(seg('walking'), seg('transit'), seg('walking'))
  const parkAndRide = trip(seg('driving'), seg('walking'), seg('transit'))
  const bikeToStation = trip(seg('biking'), seg('transit'))
  const dockBike = trip(seg('walking'), seg('biking', 'shared'), seg('walking'))
  const rentalEgress = trip(seg('transit'), seg('biking', 'shared'))
  const rideshareTransit = trip(seg('rideshare'), seg('transit'))

  const all = [walk, subway, parkAndRide, bikeToStation, dockBike, rentalEgress, rideshareTransit]

  test('drops any trip with a segment in an excluded mode', () => {
    expect(dropExcludedTrips(all, new Set(['driving']))).not.toContain(parkAndRide)
    expect(dropExcludedTrips(all, new Set(['bikeshare']))).toEqual(
      [walk, subway, parkAndRide, bikeToStation, rideshareTransit],
    )
    expect(dropExcludedTrips(all, new Set(['biking']))).toEqual(
      [walk, subway, parkAndRide, dockBike, rentalEgress, rideshareTransit],
    )
    expect(dropExcludedTrips(all, new Set(['transit']))).toEqual([walk, dockBike])
    expect(dropExcludedTrips(all, new Set(['rideshare']))).not.toContain(rideshareTransit)
  })

  test('keeps everything without exclusions', () => {
    expect(dropExcludedTrips(all, new Set())).toBe(all)
  })
})
