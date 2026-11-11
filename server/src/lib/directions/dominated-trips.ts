/** Vehicle-and-transit trips a plain walk-and-transit trip beats outright. */

import type { TripSegment } from '../../types/trip.types'

interface DominanceTrip {
  segments: Pick<TripSegment, 'mode' | 'startTime' | 'endTime' | 'duration' | 'waitSeconds'>[]
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
  return trips.filter((_, i) => {
    const mine = profiles[i]
    return !mine || !profiles.some((other, j) => j !== i && other != null && beats(other, mine))
  })
}
