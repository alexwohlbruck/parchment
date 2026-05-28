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
  private markerSnapshots = new Map<string, string>()

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

  protected updateMarkers(data: MarkerData[]) {
    if (!this.mapAPI) return

    const newMarkerIds = new Set<string>()

    for (const markerData of data) {
      const fullId = `${this.idPrefix}${markerData.id}`
      newMarkerIds.add(fullId)

      const snapshot = `${markerData.props.index}|${markerData.props.totalWaypoints}|${markerData.props.type}`
      const previous = this.markerSnapshots.get(fullId)

      if (this.mapAPI.hasMarker(fullId) && previous === snapshot) {
        this.mapAPI.setMarkerLngLat(fullId, markerData.lngLat)
        continue
      }

      if (this.mapAPI.hasMarker(fullId)) {
        this.mapAPI.removeMarker(fullId)
      }
      this.mapAPI.addVueMarker(
        fullId,
        markerData.lngLat,
        this.component,
        markerData.props,
        this.zIndex,
        markerData.dragOptions,
      )
      this.markerSnapshots.set(fullId, snapshot)
    }

    for (const oldId of this.currentMarkerIds) {
      if (!newMarkerIds.has(oldId)) {
        this.mapAPI.removeMarker(oldId)
        this.markerSnapshots.delete(oldId)
      }
    }

    this.currentMarkerIds = newMarkerIds
  }

  destroy() {
    this.markerSnapshots.clear()
    super.destroy()
  }
}
