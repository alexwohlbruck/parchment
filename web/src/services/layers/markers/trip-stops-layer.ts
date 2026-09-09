/**
 * Trip Stops Marker Layer
 *
 * Draws the stops a plan makes on the traveller's behalf — the bike rack it
 * parks at, the lot it leaves the car in — as the same marker the origin and
 * destination wear, so a stop on the timeline is a stop on the map.
 */

import { ref, type Ref } from 'vue'
import { BaseMarkerLayer, type MarkerData } from './base-marker-layer'
import WaypointMarker from '@/components/map/markers/WaypointMarker.vue'
import { tripPlaceStops, type TripStopSegment } from '@/lib/directions/trip-stops'

interface TripWithStops {
  segments: TripStopSegment[]
}

export class TripStopsLayer extends BaseMarkerLayer {
  private currentTrip: Ref<TripWithStops | null> = ref(null)

  constructor() {
    super({
      idPrefix: 'trip-stop-',
      component: WaypointMarker,
      // Below the waypoints the user asked for, above the instruction points.
      zIndex: 2,
    })
  }

  protected getData(): MarkerData[] {
    return tripPlaceStops(this.currentTrip.value?.segments).map(stop => ({
      id: stop.id,
      lngLat: stop.lngLat,
      props: {
        type: 'waypoint',
        place: stop.place,
        label: stop.label,
      },
    }))
  }

  setTrip(trip: TripWithStops | null) {
    this.currentTrip.value = trip
  }
}
