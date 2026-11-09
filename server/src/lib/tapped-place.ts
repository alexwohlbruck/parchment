import * as turf from '@turf/turf'
import type { Place } from '../types/place.types'

/** A point POI further than this from the tap is a neighbour, not the thing tapped. */
const POINT_REACH_METERS = 30

const NOT_A_PLACE = new Set(['address', 'area'])

/** Whether a reverse-geocode hit is a named place the tap landed on, rather than an address, building or region. */
export function isTappedPlace(hit: Partial<Place> | undefined, lat: number, lng: number): boolean {
  const preset = hit?.icon?.presetId
  const geometry = hit?.geometry?.value
  if (!hit?.name?.value || !geometry || !preset) return false
  if (NOT_A_PLACE.has(preset) || preset === 'building' || preset.startsWith('building/')) return false
  if (geometry.type !== 'point') return true
  const { center } = geometry
  return turf.distance([lng, lat], [center.lng, center.lat], { units: 'meters' }) <= POINT_REACH_METERS
}
