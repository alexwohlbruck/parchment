import { describe, test, expect } from 'bun:test'
import type { TripResponse, TripSegment } from '../../types/trip.types'
import { dropAvoidableStreetTransfers, splitFeedScopedId, transferChecks } from './street-transfer'

const walk = (extra: Partial<TripSegment> = {}) => ({ mode: 'walking', ...extra }) as TripSegment
const ride = (routeId: string, from: string, to: string, type = 'subway') =>
  ({
    mode: 'transit',
    details: {
      transitDetails: {
        route: { id: routeId, type },
        departureStop: { id: from },
        arrivalStop: { id: to },
      },
    },
  }) as unknown as TripSegment

const trip = (arrive: string, segments: TripSegment[]) =>
  ({ segments, latestEndTime: `2026-10-15T${arrive}:00Z` }) as TripResponse

describe('splitFeedScopedId', () => {
  test('splits on the first underscore only', () => {
    expect(splitFeedScopedId('5_A41N')).toEqual({ feedId: '5', id: 'A41N' })
    expect(splitFeedScopedId('38_GO_1')).toEqual({ feedId: '38', id: 'GO_1' })
    expect(splitFeedScopedId('A41N')).toBeNull()
  })
})

describe('transferChecks', () => {
  test('asks about the walk between two station legs of one feed', () => {
    const segments = [walk(), ride('5_F', '5_F20N', '5_A41N'), walk(), ride('5_4', '5_423N', '5_621N'), walk()]
    expect(transferChecks(segments)).toEqual([
      { walkIndex: 2, feedId: '5', alightStopId: 'A41N', boardRouteId: '4' },
    ])
  })

  test('skips transfers to a bus or across feeds, which transfers.txt cannot answer', () => {
    const toBus = [ride('5_7', '5_719N', '5_718N'), walk(), ride('6_B62', '6_1', '6_2', 'bus')]
    const toLirr = [ride('5_E', '5_G06', '5_G05'), walk(), ride('38_1', '38_15', '38_102', 'rail')]
    expect(transferChecks(toBus)).toEqual([])
    expect(transferChecks(toLirr)).toEqual([])
  })
})

describe('dropAvoidableStreetTransfers', () => {
  const street = walk({ streetTransfer: true })
  const outside = trip('20:20', [walk(), ride('5_F', 'a', 'b'), street, ride('5_4', 'c', 'd'), walk()])

  test('drops a street transfer when an in-system trip arrives within the tolerance', () => {
    const inside = trip('20:27', [walk(), ride('5_F', 'a', 'e'), walk(), ride('5_C', 'e', 'f'), walk()])
    expect(dropAvoidableStreetTransfers([outside, inside], 10 * 60_000)).toEqual([inside])
  })

  test('keeps it when the only alternative is much later', () => {
    const late = trip('20:44', [walk(), ride('6_B62', 'x', 'y', 'bus'), walk(), ride('5_M', 'z', 'w'), walk()])
    expect(dropAvoidableStreetTransfers([outside, late], 10 * 60_000)).toEqual([outside, late])
  })

  test('a walk-only or vehicle trip is not an in-system alternative', () => {
    const walking = trip('20:15', [walk()])
    const parkAndRide = trip('20:15', [{ mode: 'driving' } as TripSegment, walk(), ride('5_F', 'a', 'b'), walk()])
    expect(dropAvoidableStreetTransfers([outside, walking, parkAndRide], 10 * 60_000)).toHaveLength(3)
  })
})
