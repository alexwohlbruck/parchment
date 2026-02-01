/**
 * Waypoints Marker Layer
 * 
 * Automatically syncs waypoint markers with the directions store state.
 */

import { BaseMarkerLayer, type MarkerData } from './base-marker-layer'
import { useDirectionsStore } from '@/stores/directions.store'
import WaypointMapIcon from '@/components/map/WaypointMapIcon.vue'

export class WaypointsLayer extends BaseMarkerLayer {
  private directionsStore = useDirectionsStore()

  constructor() {
    super({
      idPrefix: 'waypoint-',
      component: WaypointMapIcon,
      zIndex: 100, // Highest priority - always on top
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
        }
      })
      .filter((m): m is MarkerData => m !== null)
  }
}
