/**
 * Vehicle Locations Marker Layer
 *
 * Shows the user's active vehicles with known locations as draggable
 * markers on the map. Dragging updates the vehicle's stored location.
 *
 * Enabled only when the "use known vehicle locations" routing
 * preference is on. Markers fade based on location staleness.
 */

import { computed } from 'vue'
import {
  BaseMarkerLayer,
  type MarkerData,
} from './base-marker-layer'
import { useVehiclesStore } from '@/stores/vehicles.store'
import { useDirectionsStore } from '@/stores/directions.store'
import VehicleLocationMarker from '@/components/map/VehicleLocationMarker.vue'

export class VehicleLocationsLayer extends BaseMarkerLayer {
  private vehiclesStore = useVehiclesStore()

  constructor() {
    const directionsStore = useDirectionsStore()
    const isEnabled = computed(
      () => directionsStore.routingPreferences.useKnownVehicleLocations !== false,
    )

    super({
      idPrefix: 'vehicle-',
      component: VehicleLocationMarker,
      enabled: isEnabled,
      zIndex: 2, // Above route lines, below waypoints
    })
  }

  protected getData(): MarkerData[] {
    return this.vehiclesStore.activeVehicles
      .filter((v) => v.lastKnownLocation)
      .map((v) => ({
        id: v.id,
        lngLat: {
          lat: v.lastKnownLocation!.lat,
          lng: v.lastKnownLocation!.lng,
        },
        props: {
          vehicleType: v.type,
          vehicleName: v.name,
          staleness: this.vehiclesStore.getLocationStaleness(v),
        },
        dragOptions: {
          onDragEnd: (lngLat: { lat: number; lng: number }) => {
            this.vehiclesStore.updateVehicleLocation(
              v.id,
              { lat: lngLat.lat, lng: lngLat.lng },
              'manual',
            )
          },
        },
      }))
  }
}
