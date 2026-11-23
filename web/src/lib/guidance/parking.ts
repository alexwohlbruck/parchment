import { isPublicParking } from '@server/lib/directions/parking-access'
import { distanceMeters } from '@/lib/map/movement-interpolation'
import { modeProfile } from './mode-profiles'
import type { LngLat } from '@/types/map.types'
import type { Place } from '@/types/place.types'

/** Close enough to the door that it's time to think about where to leave the car. */
export const PARKING_OFFER_M = 1500
/** How far from the destination a lot is still worth walking from. */
export const PARKING_SEARCH_M = 600
const MAX_OPTIONS = 6
/** Streets add this much to the straight line between a lot and the door. */
const WALK_DETOUR = 1.3

export type ParkingKind = 'garage' | 'underground' | 'street' | 'lot'

export interface ParkingOption {
  id: string
  name: string | null
  kind: ParkingKind
  location: LngLat
  walkSeconds: number
  paid: boolean | null
}

interface DrivenSegment {
  mode: string
  geometry?: LngLat[]
  end?: { label?: string; location?: LngLat }
}

export function parkingKind(tags?: Record<string, string> | null): ParkingKind {
  switch (tags?.parking) {
    case 'multi-storey':
    case 'rooftop':
      return 'garage'
    case 'underground':
      return 'underground'
    case 'street_side':
    case 'lane':
    case 'on_kerb':
    case 'half_on_kerb':
      return 'street'
    default:
      return 'lot'
  }
}

function paid(tags?: Record<string, string> | null): boolean | null {
  if (tags?.fee === 'yes') return true
  if (tags?.fee === 'no') return false
  return null
}

/** Public lots within walking distance of `destination`, shortest walk first. */
export function parkingOptions(places: Place[], destination: LngLat): ParkingOption[] {
  const walkSpeed = modeProfile('walking').baseSpeed
  return places
    .flatMap(place => {
      const center = place.geometry?.value?.center
      if (!center || !isPublicParking(place.tags)) return []
      const meters = distanceMeters(center, destination)
      if (meters > PARKING_SEARCH_M) return []
      return [{
        id: place.id,
        name: place.name?.value || null,
        kind: parkingKind(place.tags),
        location: { lat: center.lat, lng: center.lng },
        walkSeconds: (meters * WALK_DETOUR) / walkSpeed,
        paid: paid(place.tags),
      }]
    })
    .sort((a, b) => a.walkSeconds - b.walkSeconds)
    .slice(0, MAX_OPTIONS)
}

/**
 * Where the walk from a lot should lead, while driving segment `index`: the
 * end of the walk that already follows it, or the drive's own end.
 */
export function parkingDestination(segments: DrivenSegment[], index: number): { location: LngLat; label: string | null } | null {
  const drive = segments[index]
  if (drive?.mode !== 'driving') return null
  const next = segments[index + 1]
  const target = next?.mode === 'walking' ? next : drive
  const location = target.end?.location ?? target.geometry?.at(-1)
  return location ? { location, label: target.end?.label ?? null } : null
}

/** Whether to offer parking unprompted: the drive ends at the door, and the door is near. */
export function offersParking(segments: DrivenSegment[], index: number, metersLeft: number): boolean {
  return segments[index]?.mode === 'driving' && index === segments.length - 1 && metersLeft <= PARKING_OFFER_M
}
