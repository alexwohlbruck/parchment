import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import { boardRunTripId } from '@/lib/transit/transit-focus'
import type { TransitDeparture } from '@/types/place.types'

/** Opens a departure's line, following that run along it. */
export function useOpenDeparture() {
  const router = useRouter()

  return (feedId: string | undefined, departure: TransitDeparture) => {
    const routeId = departure.route?.id
    if (!feedId || !routeId) return
    const runId = departure.trip?.id
    router.push({
      name: AppRoute.TRANSIT_ROUTE,
      params: { feedId, routeId },
      query: runId ? { trip: boardRunTripId(runId, feedId) } : {},
    })
  }
}
