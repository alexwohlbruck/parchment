/**
 * Friend Locations Marker Layer
 * 
 * Automatically syncs friend location markers with friend locations state.
 * Controlled by the friends layer visibility.
 */

import { computed } from 'vue'
import { BaseMarkerLayer, type MarkerData } from './base-marker-layer'
import { useLayersStore } from '@/stores/layers.store'
import { useFriendLocations } from '@/composables/useFriendLocations'
import FriendLocationMarker from '@/components/map/FriendLocationMarker.vue'

export class FriendLocationsLayer extends BaseMarkerLayer {
  private layersStore = useLayersStore()
  private friendLocations = useFriendLocations()

  constructor() {
    const layersStore = useLayersStore()
    const isEnabled = computed(() => {
      const layer = layersStore.clientSideLayers.find(
        l => l.configuration?.id === 'friends-locations'
      )
      return layer?.visible ?? false
    })

    super({
      idPrefix: 'friend-location-',
      component: FriendLocationMarker,
      enabled: isEnabled,
      zIndex: 2, // Medium priority - between waypoints and instructions
    })
  }

  protected getData(): MarkerData[] {
    const locations = this.friendLocations.locations.value

    return locations.map(loc => ({
      id: loc.friendHandle,
      lngLat: loc.lngLat,
      props: {
        friendHandle: loc.friendHandle,
        friendAlias: loc.friendAlias,
        friendName: loc.friendName,
        friendAvatar: loc.friendPicture,
        updatedAt: loc.updatedAt,
        accuracy: loc.location.accuracy,
      },
    }))
  }
}
