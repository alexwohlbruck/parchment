/**
 * Live positions for a named set of lines.
 *
 * Both the route panel and an open itinerary want the same thing — every
 * vehicle running these routes, wherever they are — which is not what the
 * viewport feed answers.
 */

import { api } from '@/lib/api'
import type { TransitVehiclePosition } from '@/types/multimodal.types'

/** How often a view following live vehicles refreshes them. */
export const VEHICLE_POLL_MS = 5_000

export async function fetchVehiclesOnRoutes(
  feedId: string,
  routeIds: string[],
): Promise<TransitVehiclePosition[]> {
  if (!feedId || !routeIds.length) return []

  const { data } = await api.get<{ vehicles: TransitVehiclePosition[] }>(
    '/transit/route-vehicles',
    { params: { routeIds: routeIds.join(','), feedId } },
  )
  return data?.vehicles ?? []
}
