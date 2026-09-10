/**
 * Live positions for a named set of lines.
 *
 * Both the route panel and an open itinerary want the same thing — every
 * vehicle running these routes, wherever they are — which is not what the
 * viewport feed answers. The route endpoint answers it directly; the bbox
 * fallback covers instances whose server predates it.
 */

import { api } from '@/lib/api'
import type { TransitVehiclePosition } from '@/types/multimodal.types'

export interface VehicleBounds {
  north: number
  south: number
  east: number
  west: number
}

export async function fetchVehiclesOnRoutes(
  feedId: string,
  routeIds: string[],
  fallbackBounds?: () => VehicleBounds | null,
): Promise<TransitVehiclePosition[]> {
  if (!feedId || !routeIds.length) return []

  try {
    const { data } = await api.get<{ vehicles: TransitVehiclePosition[] }>(
      '/transit/route-vehicles',
      { params: { routeIds: routeIds.join(','), feedId } },
    )
    if (data?.vehicles) return data.vehicles
  } catch {
    // Endpoint not available — fall through to the bbox feed
  }

  const bounds = fallbackBounds?.()
  if (!bounds) return []
  const { data } = await api.get<{ vehicles: TransitVehiclePosition[] }>(
    '/transit/vehicles',
    { params: bounds },
  )
  const wanted = new Set(routeIds)
  return (data?.vehicles ?? []).filter(
    (v) =>
      (v.routeId && wanted.has(v.routeId)) ||
      (v.routeShortName && wanted.has(v.routeShortName)),
  )
}
