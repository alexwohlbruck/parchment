/**
 * Waypoints Marker Layer
 * 
 * Automatically syncs waypoint markers with the directions store state.
 */

import { BaseMarkerLayer, type MarkerData } from './base-marker-layer'
import { useDirectionsStore } from '@/stores/directions.store'
import { useDirectionsService } from '@/services/directions.service'
import WaypointMarker from '@/components/map/markers/WaypointMarker.vue'

export class WaypointsLayer extends BaseMarkerLayer {
  private directionsStore = useDirectionsStore()
  private directionsService = useDirectionsService()
  private markerSnapshots = new Map<string, string>()

  constructor() {
    super({
      idPrefix: 'waypoint-',
      component: WaypointMarker,
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
            type: index === 0
              ? 'origin'
              : index === waypoints.length - 1
              ? 'destination'
              : 'waypoint',
            // The marker draws the place's own icon when it has one, so the
            // record has to reach it.
            place: waypoint.place ?? null,
            draggable: true,
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

      // Includes the place identity: a waypoint's record is filled in after
      // the fact (reverse geocode, background lookup), and the marker has to
      // be rebuilt when it is, or it keeps the numbered dot it was born with.
      const place = markerData.props.place
      const snapshot = [
        markerData.props.type,
        place?.id ?? '',
        place?.icon?.icon ?? '',
        place?.name?.value ?? '',
        place?.placeType?.value ?? '',
      ].join('|')
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
