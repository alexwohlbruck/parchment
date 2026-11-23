import { byRank } from './trip-display'
import { tripType, type TripTypeSegment } from './trip-type'

export interface TripGroup<T> {
  /** i18n key under `directions.tripTypes` */
  key: string
  trips: T[]
}

/** Trips by type, each group led by its best-ranked trip and ordered by it. */
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
  return [...groups].map(([key, members]) => ({ key, trips: members }))
}
