/** Which trips a rider's excluded modes rule out. */

import type { SelectedMode, TripResponse, TripSegment } from '../../types/trip.types'
import type { TripModeToken } from '../../types/departure-profile.types'

const TAB_TOKEN: Partial<Record<SelectedMode, TripModeToken>> = {
  driving: 'driving',
  biking: 'biking',
  transit: 'transit',
  rideshare: 'rideshare',
}

/** The excluded modes still in force once the selected tab's own mode is exempted. */
export function activeExclusions(
  excluded: readonly TripModeToken[] | undefined,
  selectedMode?: SelectedMode,
): Set<TripModeToken> {
  const active = new Set(excluded ?? [])
  const tab = selectedMode ? TAB_TOKEN[selectedMode] : undefined
  if (tab) active.delete(tab)
  return active
}

/** The mode a segment rides in, or null for walking, which is never excluded. */
export function segmentModeToken(segment: Pick<TripSegment, 'mode' | 'ownership'>): TripModeToken | null {
  if (segment.ownership === 'shared') return 'bikeshare'
  switch (segment.mode) {
    case 'transit':
    case 'biking':
    case 'driving':
    case 'rideshare':
      return segment.mode
    default:
      return null
  }
}

export function usesExcludedMode(trip: Pick<TripResponse, 'segments'>, excluded: ReadonlySet<TripModeToken>): boolean {
  if (excluded.size === 0) return false
  return trip.segments.some((s) => {
    const token = segmentModeToken(s)
    return token != null && excluded.has(token)
  })
}

export function dropExcludedTrips<T extends Pick<TripResponse, 'segments'>>(
  trips: T[],
  excluded: ReadonlySet<TripModeToken>,
): T[] {
  return excluded.size === 0 ? trips : trips.filter((t) => !usesExcludedMode(t, excluded))
}
