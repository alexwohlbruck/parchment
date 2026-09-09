import { describe, it, expect } from 'vitest'
import {
  focusedLegs,
  routeIdsByFeed,
  localTripId,
  vehiclesOnFocusedRoutes,
  yourVehicleIds,
} from './transit-focus'
import type { TransitVehiclePosition } from '@/types/multimodal.types'

/**
 * Reducing an itinerary to what the map has to know about it.
 *
 * The trap here is the feed prefix. A route or trip id arrives as
 * `feedId_localId` from the planner and the boards, bare from the realtime
 * feed's own point of view, and the two vocabularies only agree once the
 * prefix is off. Getting it wrong lights up a different agency's line of
 * the same number — Metro-North's 2 for the LIRR's.
 */

const vehicle = (v: Partial<TransitVehiclePosition>): TransitVehiclePosition => ({
  vehicleId: 'v1',
  feedId: 'f1',
  position: { lat: 0, lng: 0 },
  timestamp: '2026-09-09T16:00:00Z',
  ...v,
})

const transitSegment = (over: Record<string, unknown> = {}) => ({
  mode: 'transit',
  transitDetails: {
    route: { id: 'f1_A' },
    trip: { id: 'f1_trip-7' },
    stops: [
      { id: 'f1_s1', location: { lat: 1, lng: 2 } },
      { id: 'f1_s2', location: { lat: 3, lng: 4 } },
    ],
    ...(over as Record<string, unknown>),
  },
})

describe('focusedLegs', () => {
  it('strips the feed prefix off route, trip and stop ids', () => {
    const [leg] = focusedLegs({ segments: [transitSegment()] })
    expect(leg.feedId).toBe('f1')
    expect(leg.routeIds).toEqual(['A'])
    expect(leg.tripId).toBe('trip-7')
    expect(leg.stops).toEqual([
      { stopId: 's1', lat: 1, lng: 2 },
      { stopId: 's2', lat: 3, lng: 4 },
    ])
  })

  it('keeps interchangeable lines, which are one leg to the rider', () => {
    const [leg] = focusedLegs({
      segments: [
        transitSegment({
          route: { id: 'f1_4' },
          routeOptions: [{ id: 'f1_4' }, { id: 'f1_5' }],
        }),
      ],
    })
    expect(leg.routeIds).toEqual(['4', '5'])
  })

  it('skips walking legs and legs with no route', () => {
    const legs = focusedLegs({
      segments: [
        { mode: 'walking' },
        { mode: 'transit', transitDetails: {} },
        transitSegment(),
      ],
    })
    expect(legs).toHaveLength(1)
    expect(legs[0].segmentIndex).toBe(2)
  })

  it('drops an unprefixed route rather than guess its feed', () => {
    expect(focusedLegs({ segments: [transitSegment({ route: { id: 'A' } })] })).toEqual([])
  })

  it('survives a trip with no segments at all', () => {
    expect(focusedLegs(null)).toEqual([])
    expect(focusedLegs({})).toEqual([])
  })

  it('drops stops with no usable position', () => {
    const [leg] = focusedLegs({
      segments: [
        transitSegment({
          stops: [{ id: 'f1_s1' }, { id: 'f1_s2', location: { lat: 3, lng: 4 } }],
        }),
      ],
    })
    expect(leg.stops).toEqual([{ stopId: 's2', lat: 3, lng: 4 }])
  })
})

describe('routeIdsByFeed', () => {
  it('unions a feed\'s lines across legs without repeating them', () => {
    const legs = focusedLegs({
      segments: [
        transitSegment({ route: { id: 'f1_A' } }),
        transitSegment({ route: { id: 'f1_A' } }),
        transitSegment({ route: { id: 'f2_C' } }),
      ],
    })
    expect(routeIdsByFeed(legs)).toEqual(new Map([['f1', ['A']], ['f2', ['C']]]))
  })
})

describe('localTripId', () => {
  it('strips only its own feed\'s prefix', () => {
    expect(localTripId(vehicle({ tripId: 'f1_trip-7' }))).toBe('trip-7')
    expect(localTripId(vehicle({ tripId: 'f2_trip-7' }))).toBe('f2_trip-7')
    expect(localTripId(vehicle({}))).toBeNull()
  })
})

describe('vehiclesOnFocusedRoutes', () => {
  const legs = focusedLegs({ segments: [transitSegment({ route: { id: 'f1_A' } })] })

  it('matches by route id or by the short name the feed publishes', () => {
    const ids = vehiclesOnFocusedRoutes(legs, [
      vehicle({ vehicleId: 'byId', routeId: 'A' }),
      vehicle({ vehicleId: 'byName', routeShortName: 'A' }),
      vehicle({ vehicleId: 'otherLine', routeId: 'C' }),
    ])
    expect(ids).toEqual(new Set(['byId', 'byName']))
  })

  it('will not match another feed\'s line of the same name', () => {
    const ids = vehiclesOnFocusedRoutes(legs, [
      vehicle({ vehicleId: 'wrongFeed', feedId: 'f2', routeId: 'A' }),
    ])
    expect(ids.size).toBe(0)
  })
})

describe('yourVehicleIds', () => {
  it('picks out the run each leg is booked on', () => {
    const legs = focusedLegs({
      segments: [
        transitSegment({ route: { id: 'f1_A' }, trip: { id: 'f1_trip-7' } }),
        transitSegment({ route: { id: 'f1_C' }, trip: { id: 'f1_trip-9' } }),
      ],
    })
    const ids = yourVehicleIds(legs, [
      vehicle({ vehicleId: 'mine-a', tripId: 'f1_trip-7' }),
      vehicle({ vehicleId: 'mine-c', tripId: 'f1_trip-9' }),
      vehicle({ vehicleId: 'someone-else', tripId: 'f1_trip-8' }),
    ])
    expect(ids).toEqual(new Set(['mine-a', 'mine-c']))
  })

  // The caller reads empty as "dim nothing" — every train at full strength
  // beats three of them faded behind a fourth that is not the rider's.
  it('is empty when no leg can name its run', () => {
    const legs = focusedLegs({ segments: [transitSegment({ trip: {} })] })
    expect(yourVehicleIds(legs, [vehicle({ tripId: 'f1_trip-7' })]).size).toBe(0)
  })

  it('is empty when the run is named but no vehicle is reporting it', () => {
    const legs = focusedLegs({ segments: [transitSegment()] })
    expect(yourVehicleIds(legs, [vehicle({ tripId: 'f1_trip-99' })]).size).toBe(0)
  })
})
