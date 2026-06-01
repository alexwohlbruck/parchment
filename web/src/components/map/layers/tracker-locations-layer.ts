/**
 * Tracker Locations Marker Layer
 *
 * Shows tracked items (vehicles, devices, etc.) as markers on the map.
 * Hover reveals a tooltip with details; click navigates to the tracker
 * detail page. Currently fed by the vehicles store; designed to accept
 * additional tracker sources in the future.
 *
 * Visibility is controlled by the Trackers layer in the layer selector,
 * following the same pattern as the friend locations layer.
 */

import { computed } from 'vue'
import {
  BaseMarkerLayer,
  type MarkerData,
} from './base-marker-layer'
import { useVehiclesStore } from '@/stores/vehicles.store'
import { useLayersStore } from '@/stores/layers.store'
import TrackerMarker from '@/components/map/TrackerMarker.vue'
import { VEHICLE_TYPE_LABELS } from '@/lib/vehicle-mode-mapping'
import type { VehicleType } from '@/types/multimodal.types'

export class TrackerLocationsLayer extends BaseMarkerLayer {
  private vehiclesStore = useVehiclesStore()

  constructor() {
    const layersStore = useLayersStore()
    const isEnabled = computed(() => {
      const layer = layersStore.layers.find(
        l => l.configuration?.id === 'trackers-locations'
      )
      return layer?.visible ?? false
    })

    super({
      idPrefix: 'tracker-',
      component: TrackerMarker,
      enabled: isEnabled,
      zIndex: 2,
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
          trackerId: v.id,
          trackerName: v.name || VEHICLE_TYPE_LABELS[v.type as VehicleType] || v.type,
          trackerType: v.type,
          updatedAt: v.locationUpdatedAt ? new Date(v.locationUpdatedAt) : undefined,
          staleness: this.vehiclesStore.getLocationStaleness(v),
        },
      }))
  }
}
