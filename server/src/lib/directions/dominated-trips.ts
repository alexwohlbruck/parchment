/** Vehicle-and-transit trips a plainer trip beats outright. */

import type { TripSegment } from '../../types/trip.types'

interface DominanceTrip {
  segments: Pick<TripSegment, 'mode' | 'ownership' | 'startTime' | 'endTime' | 'duration' | 'waitSeconds'>[]
}

interface Profile {
  start: number
  end: number
  rides: number
  walkSeconds: number
  usesVehicle: boolean
}

function profile(trip: DominanceTrip): Profile | null {
  const { segments } = trip
  if (!segments.length || !segments.some((s) => s.mode === 'transit')) return null
  return {
    start: Date.parse(segments[0].startTime),
    end: Date.parse(segments[segments.length - 1].endTime),
    rides: segments.filter((s) => s.mode === 'transit').length,
    walkSeconds: segments
      .filter((s) => s.mode === 'walking')
      .reduce((sum, s) => sum + s.duration - (s.waitSeconds ?? 0), 0),
    usesVehicle: segments.some((s) => s.mode !== 'walking' && s.mode !== 'transit'),
  }
}

function beats(walker: Profile, rider: Profile): boolean {
  return !walker.usesVehicle && rider.usesVehicle
    && walker.start >= rider.start && walker.end <= rider.end
    && walker.rides <= rider.rides && walker.walkSeconds <= rider.walkSeconds
}

/**
 * Drop a trip that drives or rides to transit when a walk-and-transit trip
 * leaves no earlier, arrives no later, boards no more often and walks no
 * further: driving to a tram one stop from the bus you could have walked to.
 */
export function dropDominatedTransitTrips<T extends DominanceTrip>(trips: T[]): T[] {
  const profiles = trips.map(profile)
  return dropUncompetitiveParkAndRide(trips.filter((_, i) => {
    const mine = profiles[i]
    return !mine || !profiles.some((other, j) => j !== i && other != null && beats(other, mine))
  }))
}

/** How much slower than driving the whole way a park-and-ride may be. Parking
 *  downtown costs money and time the drive's duration doesn't show, so a little
 *  slower is still worth offering; several times slower never is. */
const PARK_AND_RIDE_RATIO = 1.3
const PARK_AND_RIDE_SLACK_MS = 5 * 60_000

const spanMs = (trip: DominanceTrip) =>
  Date.parse(trip.segments[trip.segments.length - 1].endTime) - Date.parse(trip.segments[0].startTime)

const drivesOwnCar = (trip: DominanceTrip) =>
  trip.segments.some((s) => s.mode === 'driving' && s.ownership !== 'shared')

/**
 * Drop a trip that drives your own car to transit when driving the whole way
 * is much faster. Nobody parks in a paid garage to ride a streetcar half a
 * mile when the destination was six minutes away by car.
 */
function dropUncompetitiveParkAndRide<T extends DominanceTrip>(trips: T[]): T[] {
  const drives = trips.filter((t) =>
    t.segments.length > 0
    && drivesOwnCar(t)
    && t.segments.every((s) => s.mode === 'driving' || s.mode === 'walking'))
  if (!drives.length) return trips
  const fastestDrive = Math.min(...drives.map(spanMs))
  const limit = fastestDrive * PARK_AND_RIDE_RATIO + PARK_AND_RIDE_SLACK_MS
  return trips.filter((t) =>
    !(drivesOwnCar(t) && t.segments.some((s) => s.mode === 'transit') && spanMs(t) > limit))
}
