/**
 * Waypoints Marker Layer
 * 
 * Automatically syncs waypoint markers with the directions store state.
 */

import { BaseMarkerLayer, type MarkerData } from './base-marker-layer'
import { useDirectionsStore } from '@/stores/directions.store'
import { useDirectionsService } from '@/services/directions.service'
import WaypointMapIcon from '@/components/map/WaypointMapIcon.vue'

export class WaypointsLayer extends BaseMarkerLayer {
  private directionsStore = useDirectionsStore()
  private directionsService = useDirectionsService()

  constructor() {
    super({
      idPrefix: 'waypoint-',
      component: WaypointMapIcon,
      zIndex: 3, // Highest priority among map markers
    })
  }

  protected getData(): MarkerData[] {
    const waypoints = this.directionsStore.waypoints

    return waypoints
      .map((waypoint, index) => {
        if (!waypoint.lngLat) return null

        return {
          id: String(index),
          lngLat: waypoint.lngLat,
          props: {
            index,
            totalWaypoints: waypoints.length,
            type: index === 0
              ? 'origin'
              : index === waypoints.length - 1
              ? 'destination'
              : 'waypoint',
          },
          dragOptions: {
            onDragEnd: (lngLat) => {
              this.directionsService.moveWaypoint(index, lngLat)
            },
          },
        }
      })
      .filter((m): m is NonNullable<typeof m> => m !== null) as MarkerData[]
  }
}
