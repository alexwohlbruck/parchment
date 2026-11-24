import { isPublicParking } from '@server/lib/directions/parking-access'
import { distanceMeters } from '@/lib/map/movement-interpolation'
import { modeProfile } from './mode-profiles'
import type { LngLat } from '@/types/map.types'
import type { Place } from '@/types/place.types'

export type ParkedVehicle = 'car' | 'bike'

interface VehicleParking {
  presetId: string
  /** Close enough to the door that it's time to think about where to leave it. */
  offerMeters: number
  /** How far from the destination a spot is still worth walking from. */
  searchMeters: number
  rideMode: 'driving' | 'cycling'
}

export const PARKING: Record<ParkedVehicle, VehicleParking> = {
  car: { presetId: 'amenity/parking', offerMeters: 1500, searchMeters: 600, rideMode: 'driving' },
  bike: { presetId: 'amenity/bicycle_parking', offerMeters: 500, searchMeters: 300, rideMode: 'cycling' },
}
const MAX_OPTIONS = 6
/** Streets add this much to the straight line between a lot and the door. */
const WALK_DETOUR = 1.3

export type ParkingKind = 'garage' | 'underground' | 'street' | 'lot' | 'rack' | 'lockers' | 'shelter'

export interface ParkingOption {
  id: string
  name: string | null
  address: string | null
  kind: ParkingKind
  location: LngLat
  walkSeconds: number
  paid: boolean | null
}

interface RiddenSegment {
  mode: string
  ownership?: string
  geometry?: LngLat[]
  end?: { label?: string; location?: LngLat }
}

export function parkingKind(tags?: Record<string, string> | null): ParkingKind {
  if (tags?.amenity === 'bicycle_parking') return bikeParkingKind(tags)
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

function bikeParkingKind(tags: Record<string, string>): ParkingKind {
  switch (tags.bicycle_parking) {
    case 'lockers':
      return 'lockers'
    case 'shed':
    case 'building':
      return 'shelter'
    default:
      return tags.covered === 'yes' ? 'shelter' : 'rack'
  }
}

/** The vehicle a rider would park at the end of `segment`, if it's theirs to leave anywhere. */
export function parkedVehicle(segment?: RiddenSegment): ParkedVehicle | null {
  if (segment?.mode === 'driving') return 'car'
  if ((segment?.mode === 'cycling' || segment?.mode === 'biking') && segment.ownership !== 'shared') return 'bike'
  return null
}

function paid(tags?: Record<string, string> | null): boolean | null {
  if (tags?.fee === 'yes') return true
  if (tags?.fee === 'no') return false
  return null
}

/** Public spots within walking distance of `destination`, shortest walk first. */
export function parkingOptions(places: Place[], destination: LngLat, vehicle: ParkedVehicle = 'car'): ParkingOption[] {
  const walkSpeed = modeProfile('walking').baseSpeed
  return places
    .flatMap(place => {
      const center = place.geometry?.value?.center
      if (!center || !isPublicParking(place.tags)) return []
      const meters = distanceMeters(center, destination)
      if (meters > PARKING[vehicle].searchMeters) return []
      return [{
        id: place.id,
        name: place.name?.value || place.tags?.operator || null,
        address: place.address?.value?.street1 || null,
        kind: parkingKind(place.tags),
        location: { lat: center.lat, lng: center.lng },
        walkSeconds: (meters * WALK_DETOUR) / walkSpeed,
        paid: paid(place.tags),
      }]
    })
    .sort((a, b) => a.walkSeconds - b.walkSeconds)
    .slice(0, MAX_OPTIONS)
}

export interface ParkingDestination {
  location: LngLat
  label: string | null
  vehicle: ParkedVehicle
}

/**
 * Where the walk from a spot should lead, while riding segment `index`: the
 * end of the walk that already follows it, or the ride's own end.
 */
export function parkingDestination(segments: RiddenSegment[], index: number): ParkingDestination | null {
  const ride = segments[index]
  const vehicle = parkedVehicle(ride)
  if (!vehicle) return null
  const next = segments[index + 1]
  const target = next?.mode === 'walking' ? next : ride
  const location = target.end?.location ?? target.geometry?.at(-1)
  return location ? { location, label: target.end?.label ?? null, vehicle } : null
}

/** Whether to offer parking unprompted: the ride ends at the door, and the door is near. */
export function offersParking(segments: RiddenSegment[], index: number, metersLeft: number): boolean {
  const vehicle = parkedVehicle(segments[index])
  return !!vehicle && index === segments.length - 1 && metersLeft <= PARKING[vehicle].offerMeters
}
