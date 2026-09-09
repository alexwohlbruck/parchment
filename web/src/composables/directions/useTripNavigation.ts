import { useRouter } from 'vue-router'
import { api } from '@/lib/api'
import {
  serializeDirectionsQuery,
  shareableWaypointId,
} from '@/lib/directions/directions-url'
import { tripSignature } from '@/lib/directions/trip-signature'
import { useDirectionsStore } from '@/stores/directions.store'
import type { TripOption, TripsResponse } from '@/types/directions.types'

/**
 * Opening a suggestion from any of the result views.
 *
 * `request` is a getter so the caller can pass a prop without it going stale.
 */
export function useTripNavigation(request: () => TripsResponse['request']) {
  const router = useRouter()
  const directionsStore = useDirectionsStore()

  function openTrip(trip: TripOption) {
    // The trip URL carries the full planning inputs (same wp/mode/sort/depart
    // format as the directions URL) plus the trip's stable signature, so a
    // refresh or a shared link can re-plan and find this same trip again.
    const query = {
      ...serializeDirectionsQuery({
        waypoints: request().waypoints.map(wp => ({
          lat: wp.coordinate.lat,
          lng: wp.coordinate.lng,
          label: wp.name || undefined,
          id: shareableWaypointId(wp.place),
        })),
        mode: directionsStore.selectedMode,
        sort: directionsStore.sortPreference || undefined,
        depart: directionsStore.departureTime || undefined,
      }),
      sig: tripSignature(trip.segments),
    }
    router.push({ name: 'trip', params: { id: trip.id }, query })

    // Persist a server-side snapshot in the background and slip its token
    // into the URL — the snapshot makes refresh and cross-device shares
    // exact, independent of schedule drift. Best-effort: the sig/re-plan
    // path still recovers the trip if this fails.
    api
      .post('/directions/trips', { request: query, trip })
      .then(({ data }) => {
        router
          .replace({
            name: 'trip',
            params: { id: trip.id },
            query: { ...query, pt: data.id },
          })
          .catch(() => {})
      })
      .catch(() => {})
  }

  return { openTrip }
}
