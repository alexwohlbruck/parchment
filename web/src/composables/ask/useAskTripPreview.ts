import { distance } from '@turf/turf'
import { useAskStore, type AskTrip } from '@/stores/ask.store'
import { useDirectionsStore } from '@/stores/directions.store'
import { useDirectionsService } from '@/services/directions.service'
import { useMapService } from '@/services/map/map.service'
import { endpointPlace, proposedTrip } from '@/lib/ask/ask-trip'
import type { AskEndpoint } from '@/types/ask.types'
import type { Waypoint } from '@/types/map.types'

const SAME_SPOT_KM = 0.05

/** Plans Ask's proposed trip the way Directions does, and draws it on the map. */
export function useAskTripPreview() {
  const askStore = useAskStore()
  const directionsStore = useDirectionsStore()
  const directionsService = useDirectionsService()
  const mapService = useMapService()

  function waypoint(endpoint: AskEndpoint): Waypoint {
    const current = directionsService.getCurrentLocationWaypoint()
    const lngLat = { lng: endpoint.lng, lat: endpoint.lat }
    const isCurrent =
      current?.lngLat &&
      distance([lngLat.lng, lngLat.lat], [current.lngLat.lng, current.lngLat.lat]) < SAME_SPOT_KM
    return isCurrent ? current : { lngLat, place: endpointPlace(endpoint) }
  }

  async function planHere() {
    await directionsService.getDirections()
    return directionsStore.trips
  }

  async function preview(index: number, trip: AskTrip) {
    directionsService.clearTrip()
    const arriveBy = trip.time?.mode === 'arriveBy' ? trip.time.at : null
    directionsService.setWaypoints([
      waypoint(trip.from),
      ...(trip.stops ?? []).map(stop => ({
        ...waypoint(stop),
        ...(stop.minutes && { timeConstraint: { mode: 'departAfter' as const, dwellTime: stop.minutes } }),
      })),
      { ...waypoint(trip.to), ...(arriveBy && { timeConstraint: { mode: 'arriveBy', time: arriveBy } }) },
    ])
    directionsStore.departureTime = trip.time?.mode === 'departAfter' ? trip.time.at : null
    if (directionsStore.selectedMode !== 'multi' && directionsStore.selectedMode !== trip.kind) {
      directionsStore.selectedMode = 'multi'
    }
    const trips = trip.plan ? await directionsService.showPlan(trip.plan) : await planHere()
    if (askStore.exchanges[index]?.trip !== trip) return
    const chosen =
      trips && (trip.tripIndex !== undefined ? trips.trips[trip.tripIndex] : proposedTrip(trips.trips, trip.kind, trip.lines))
    askStore.setPlan(index, chosen ? { trips, tripId: chosen.id } : null)
    if (chosen) mapService.setVisibleTrips([chosen.id])
  }

  return { preview, clear: directionsService.clearTrip }
}
