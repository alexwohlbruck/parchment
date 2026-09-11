/**
 * Trip type — the combination pattern, not the longest mode. A subway trip
 * with two long walks is still a transit trip ("Transit & Walking"), a drive
 * to the station is "Park & Ride". Mirrors the trip-combination taxonomy the
 * planner generates from.
 */
import { movingDuration } from './trip-display'

export interface TripTypeSegment {
  mode: string
  duration?: number
  waitSeconds?: number
  routeType?: string
  sharedMobilityDetails?: { vehicleType?: string } | null
}

export interface TripType {
  /** i18n key under `directions.tripTypes` */
  key: string
  /** Mode the type's icon comes from */
  iconMode: string
}

/**
 * Walking below this in motion is access or transfer, not a journey of its
 * own — a transit trip stays "Transit" rather than "Transit & Walking".
 */
const SIGNIFICANT_WALK_SEC = 900

function sharedKind(segments: TripTypeSegment[]): 'scooter' | 'bike' | null {
  const shared = segments.find(s => s.sharedMobilityDetails)
  if (!shared) return null
  return shared.sharedMobilityDetails?.vehicleType === 'scooter'
    ? 'scooter'
    : 'bike'
}

export function tripType(segments: TripTypeSegment[]): TripType {
  const has = (m: string) => segments.some(s => s.mode === m)
  const shared = sharedKind(segments)

  if (!has('transit')) {
    if (shared) {
      return {
        key: shared === 'scooter' ? 'scootershare' : 'bikeshare',
        iconMode: 'cycling',
      }
    }
    if (has('rideshare')) return { key: 'rideshare', iconMode: 'rideshare' }
    if (has('driving')) return { key: 'driving', iconMode: 'driving' }
    if (has('cycling')) return { key: 'cycling', iconMode: 'cycling' }
    return { key: 'walking', iconMode: 'walking' }
  }

  if (has('driving')) return { key: 'parkAndRide', iconMode: 'transit' }
  if (has('rideshare')) return { key: 'transitRideshare', iconMode: 'transit' }
  if (shared) {
    return {
      key: shared === 'scooter' ? 'transitScooter' : 'transitBikeShare',
      iconMode: 'transit',
    }
  }
  if (has('cycling')) return { key: 'transitBike', iconMode: 'transit' }

  const walkSec = segments.reduce(
    (sum, s) => sum + (s.mode === 'walking' ? movingDuration(s) : 0),
    0,
  )
  return {
    key: walkSec >= SIGNIFICANT_WALK_SEC ? 'transitWalking' : 'transit',
    iconMode: 'transit',
  }
}

/** The transit segment the trip's icon should represent. */
export function longestTransitSegment<T extends { mode: string; duration: number }>(
  segments: T[],
): T | null {
  let longest: T | null = null
  for (const seg of segments) {
    if (seg.mode !== 'transit') continue
    if (!longest || seg.duration > longest.duration) longest = seg
  }
  return longest
}
