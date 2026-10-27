import type { TripOption } from '@/types/directions.types'

export function isLegNavigable(trip: TripOption, legIndex: number): boolean {
  const leg = trip.segments.filter(s => (s.legIndex ?? 0) === legIndex)
  const hasShape = leg.some(s => (s.geometry?.length ?? 0) > 1)
  return hasShape && leg.every((s, index) =>
    (s.geometry?.length ?? 0) > 1 || (
      s.mode === 'walking' && s.distance === 0 &&
      leg[index - 1]?.mode === 'transit' && leg[index + 1]?.mode === 'transit'
    ),
  )
}

export function nextNavigableLeg(trip: TripOption, after: number): number | null {
  const legs = new Set(trip.segments.map(s => s.legIndex ?? 0))
  for (const leg of [...legs].sort((a, b) => a - b)) {
    if (leg > after && isLegNavigable(trip, leg)) return leg
  }
  return null
}
