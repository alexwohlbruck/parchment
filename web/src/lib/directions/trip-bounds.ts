import type { TripsResponse } from '@/types/directions.types'

export interface Bounds {
  minLat: number
  minLng: number
  maxLat: number
  maxLng: number
}

/**
 * Bounds of the visible trips' geometry plus the requested waypoints, which
 * can sit off the snapped route (a POI pinned beside the road).
 */
export function tripsBounds(
  trips: TripsResponse,
  visibleTripIds: Set<string>,
): Bounds | null {
  const bounds = { minLat: Infinity, minLng: Infinity, maxLat: -Infinity, maxLng: -Infinity }
  const extend = (c: { lat?: unknown; lng?: unknown } | null | undefined) => {
    if (typeof c?.lat !== 'number' || typeof c.lng !== 'number') return
    if (Math.abs(c.lat) > 90 || Math.abs(c.lng) > 180) return
    bounds.minLat = Math.min(bounds.minLat, c.lat)
    bounds.maxLat = Math.max(bounds.maxLat, c.lat)
    bounds.minLng = Math.min(bounds.minLng, c.lng)
    bounds.maxLng = Math.max(bounds.maxLng, c.lng)
  }

  const visible = trips.trips.filter(trip => visibleTripIds.has(trip.id))
  if (visible.length === 0) return null

  for (const trip of visible) {
    for (const segment of trip.segments) {
      if (Array.isArray(segment.geometry)) segment.geometry.forEach(extend)
    }
  }
  trips.request?.waypoints?.forEach(wp => extend(wp?.coordinate))

  return Number.isFinite(bounds.minLat) ? bounds : null
}

/** The view already frames these bounds: they sit inside it and span at least `fill` of it one way or the other. */
export function boundsFillView(
  bounds: Bounds,
  view: { north: number; south: number; east: number; west: number } | null,
  fill = 0.5,
): boolean {
  if (!view) return false
  const inside = bounds.minLat >= view.south && bounds.maxLat <= view.north && bounds.minLng >= view.west && bounds.maxLng <= view.east
  if (!inside) return false
  const tall = (bounds.maxLat - bounds.minLat) / (view.north - view.south || 1)
  const wide = (bounds.maxLng - bounds.minLng) / (view.east - view.west || 1)
  return Math.max(tall, wide) >= fill
}
