import type { Place } from '@/types/place.types'

export interface ArrivalPointsQuery {
  presetId: string
  placeId: string
  mode: string
  north: number
  south: number
  east: number
  west: number
}

/** What to ask the server for, or null when a place is too small or too bare to have arrival points. */
export function arrivalPointsQuery(
  place: Partial<Place> | null | undefined,
  mode: string,
): ArrivalPointsQuery | null {
  const presetId = place?.icon?.presetId
  const bounds = place?.geometry?.value?.bounds
  if (!place?.id || !presetId || !bounds) return null
  return {
    presetId,
    placeId: place.id,
    mode,
    north: bounds.maxLat,
    south: bounds.minLat,
    east: bounds.maxLng,
    west: bounds.minLng,
  }
}

/**
 * The large place whose arrival points are on offer. Picking one of its points
 * makes that point the destination, and the offer has to survive that.
 */
export function arrivalParent<T extends { id?: string }>(
  destination: T | null,
  parent: T | null,
  points: readonly { id: string }[],
): T | null {
  if (!destination?.id) return null
  if (parent && points.some(point => point.id === destination.id)) return parent
  return destination
}
