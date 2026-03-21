/**
 * User Location Marker Layer
 *
 * Displays the current user's location on the map using the centralized
 * geolocation service. Automatically syncs with geolocation state.
 */

import { BaseMarkerLayer, type MarkerData } from './base-marker-layer'
import { useGeolocationService } from '@/services/geolocation.service'
import UserLocationMarker from '@/components/map/UserLocationMarker.vue'

export class UserLocationLayer extends BaseMarkerLayer {
  private geolocation = useGeolocationService()

  constructor() {
    super({
      idPrefix: 'user-location-',
      component: UserLocationMarker,
      zIndex: 0, // Below friend markers
    })
  }

  protected getData(): MarkerData[] {
    const lngLat = this.geolocation.lngLat.value
    if (!lngLat) return []

    return [
      {
        id: 'self',
        lngLat,
        props: {
          accuracy: this.geolocation.accuracy.value,
          heading: this.geolocation.heading.value,
          mode: 'dot',
        },
      },
    ]
  }
}
