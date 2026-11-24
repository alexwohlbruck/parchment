import { byRank } from './trip-display'
import { tripType, type TripTypeSegment } from './trip-type'

export interface TripGroup<T> {
  /** i18n key under `directions.tripTypes` */
  key: string
  trips: T[]
}

/** Most common ways of getting around first, combined trips after. */
const TYPE_ORDER = [
  'transit',
  'transitWalking',
  'driving',
  'walking',
  'cycling',
  'bikeshare',
  'scootershare',
  'rideshare',
  'transitBikeShare',
  'transitScooter',
  'parkAndRide',
  'transitBike',
  'transitRideshare',
]

const typeRank = (key: string) => {
  const index = TYPE_ORDER.indexOf(key)
  return index === -1 ? TYPE_ORDER.length : index
}

/** Trips by type, common types first, each group in rank order. */
export function groupByTripType<T extends { rank: number; segments: TripTypeSegment[] }>(
  trips: readonly T[],
): TripGroup<T>[] {
  const groups = new Map<string, T[]>()
  for (const trip of byRank(trips)) {
    const { key } = tripType(trip.segments)
    const group = groups.get(key)
    if (group) group.push(trip)
    else groups.set(key, [trip])
  }
  return [...groups]
    .map(([key, members]) => ({ key, trips: members }))
    .sort((a, b) => typeRank(a.key) - typeRank(b.key))
}
