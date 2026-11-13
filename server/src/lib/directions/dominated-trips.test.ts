import { describe, expect, test } from 'bun:test'
import { dropDominatedTransitTrips } from './dominated-trips'

const at = (minute: number) => new Date(Date.UTC(2026, 10, 11, 21, minute)).toISOString()
const seg = (mode: string, from: number, to: number, waitMinutes = 0) => ({
  mode, startTime: at(from), endTime: at(to), duration: (to - from) * 60, waitSeconds: waitMinutes * 60,
}) as any
const trip = (name: string, ...segments: any[]) => ({ name, segments })
const names = (trips: { name: string }[]) => trips.map((t) => t.name)

describe('dropDominatedTransitTrips', () => {
  const walkToBus = trip('walk+27+blue',
    seg('walking', 26, 30), seg('transit', 31, 36), seg('walking', 36, 42, 4), seg('transit', 42, 48))

  test('drops park-and-ride onto a tram when walking to the bus arrives as soon', () => {
    const parkAndRide = trip('drive+gold+27+blue',
      seg('driving', 19, 22), seg('transit', 22, 24), seg('walking', 24, 31, 2),
      seg('transit', 31, 36), seg('walking', 36, 42, 4), seg('transit', 42, 48))
    expect(names(dropDominatedTransitTrips([walkToBus, parkAndRide]))).toEqual(['walk+27+blue'])
  })

  test('keeps bike-to-station when it saves walking', () => {
    const bike = trip('bike+27+blue',
      seg('biking', 28, 30), seg('transit', 31, 36), seg('walking', 36, 38), seg('transit', 42, 48))
    expect(dropDominatedTransitTrips([walkToBus, bike])).toHaveLength(2)
  })

  test('leaves walk-and-transit alternatives to each other', () => {
    const later = trip('walk+9', seg('walking', 26, 30), seg('transit', 31, 50))
    expect(dropDominatedTransitTrips([walkToBus, later])).toHaveLength(2)
  })

  test('never drops trips without transit', () => {
    const drive = trip('drive', seg('driving', 26, 32))
    expect(names(dropDominatedTransitTrips([walkToBus, drive]))).toEqual(['walk+27+blue', 'drive'])
  })

  describe('park-and-ride against driving the whole way', () => {
    const drive = trip('drive', seg('driving', 32, 38))

    test('drops a park-and-ride several times slower than the drive', () => {
      const parkAndRide = trip('drive+510', seg('driving', 54, 58), seg('walking', 58, 62, 2), seg('transit', 62, 66), seg('walking', 66, 80))
      expect(names(dropDominatedTransitTrips([drive, parkAndRide]))).toEqual(['drive'])
    })

    test('keeps a park-and-ride competitive with a long drive', () => {
      const longDrive = trip('drive', seg('driving', 0, 45))
      const parkAndRide = trip('drive+rail', seg('driving', 0, 15), seg('transit', 18, 50), seg('walking', 50, 55))
      expect(dropDominatedTransitTrips([longDrive, parkAndRide])).toHaveLength(2)
    })

    test('keeps park-and-ride when no drive was planned', () => {
      const parkAndRide = trip('drive+510', seg('driving', 54, 58), seg('transit', 62, 66), seg('walking', 66, 80))
      expect(dropDominatedTransitTrips([parkAndRide])).toHaveLength(1)
    })

    test('a taxi to the station is not measured against your own car', () => {
      const taxi = trip('taxi+510', { ...seg('driving', 54, 58), ownership: 'shared' }, seg('transit', 62, 66), seg('walking', 66, 80))
      expect(dropDominatedTransitTrips([drive, taxi])).toHaveLength(2)
    })
  })
})
