import { multimodalTripService } from './trip.service'
import { attachHazards } from './route-hazards.service'
import { attachLanes } from './route-lanes.service'
import { getPermissions, hasPermission } from './auth.service'
import { PermissionId } from '../types/auth.types'
import type { MultimodalTripResponse, TripRequest } from '../types/trip.types'

/** Comfort hazards and travel time previews are premium; safety hazards go to everyone. */
export async function hasPremiumNavigation(userId: string | undefined): Promise<boolean> {
  if (!userId) return false
  return hasPermission(await getPermissions(userId), PermissionId.PREMIUM_NAVIGATION)
}

/** A trip planned as Directions shows it, hazards and lanes included. */
export async function planTripFor(request: TripRequest, userId: string | undefined): Promise<MultimodalTripResponse> {
  const result = await multimodalTripService.planTrip(request)
  const premium = await hasPremiumNavigation(userId)
  const departure = request.preferredDepartureTime ? new Date(request.preferredDepartureTime) : undefined
  await Promise.all([
    ...result.trips.map(candidate => attachHazards((candidate.trip?.segments ?? []) as any[], { premium, departure })),
    attachLanes(result.trips.flatMap(candidate => (candidate.trip?.segments ?? []).flatMap(s => [s, ...(s.details?.multimodalSegments ?? [])]))),
  ])
  return result
}
