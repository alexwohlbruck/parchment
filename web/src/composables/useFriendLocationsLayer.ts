/**
 * Friend Locations Layer Controller
 *
 * This composable manages the friend locations feature globally.
 * It watches the Friends layer visibility and starts/stops polling accordingly.
 * It also broadcasts the user's own location when sharing is enabled.
 */

import { watch, computed, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import { createSharedComposable } from '@vueuse/core'
import { useRouter } from 'vue-router'
import { useLayersStore } from '@/stores/layers.store'
import { useIdentityStore } from '@/stores/identity.store'
import { useFriendsStore } from '@/stores/friends.store'
import { useFriendLocations } from '@/composables/useFriendLocations'
import { useE2eeLocationBroadcast } from '@/composables/useE2eeLocationBroadcast'
import { useMapService } from '@/services/map.service'
import { mapEventBus } from '@/lib/eventBus'
import { AppRoute } from '@/router'

const POLL_INTERVAL = 30000 // 30 seconds

function friendLocationsLayerComposable() {
  const layersStore = useLayersStore()
  const identityStore = useIdentityStore()
  const friendsStore = useFriendsStore()
  const friendLocations = useFriendLocations()
  const locationBroadcast = useE2eeLocationBroadcast()
  const mapService = useMapService()
  const router = useRouter()

  const { layers } = storeToRefs(layersStore)
  const { isSetupComplete } = storeToRefs(identityStore)

  // Find the friends layer
  const friendsLayer = computed(() => {
    return layers.value.find(
      l => l.configuration?.id === 'friends-locations'
    )
  })

  const isLayerVisible = computed(() => {
    return friendsLayer.value?.visible ?? false
  })

  let initialized = false

  /**
   * Initialize the friend locations layer controller.
   * Should be called after the user is authenticated.
   */
  async function initialize() {
    if (initialized) return
    initialized = true

    // Wait for identity to be set up
    await identityStore.initialize()
    
    // Load friends data (needed for decryption key lookup)
    await friendsStore.loadAll()

    // Start services if layer is already visible and identity is ready
    if (isLayerVisible.value && isSetupComplete.value) {
      await startLocationServices()
    }

    // Listen for friend marker clicks to navigate to friend detail
    mapEventBus.on('click:friend-marker', handleFriendMarkerClick)

    // Watch for layer visibility changes
    watch(
      isLayerVisible,
      async (visible) => {
        if (visible && isSetupComplete.value) {
          await startLocationServices()
        } else {
          stopLocationServices()
        }
      }
    )

    // Also watch for identity setup completion
    watch(
      isSetupComplete,
      async (complete) => {
        if (complete && isLayerVisible.value) {
          await startLocationServices()
        }
      }
    )

    // Note: Friend location markers are now automatically managed by FriendLocationsLayer
    // which watches both the layer visibility and friend locations data
  }

  function handleFriendMarkerClick({ friendHandle }: { friendHandle: string }) {
    router.push({
      name: AppRoute.FRIEND_DETAIL,
      params: { handle: friendHandle },
    })
  }

  async function startLocationServices() {
    // Sync friend keys before fetching locations to ensure we have latest public keys
    await friendsStore.syncKeys()
    
    await friendLocations.fetchLocations()
    friendLocations.startPolling(POLL_INTERVAL)
    locationBroadcast.start({ intervalMs: POLL_INTERVAL })
  }

  function stopLocationServices() {
    friendLocations.stopPolling()
    locationBroadcast.stop()
    // Note: Markers are automatically cleared by FriendLocationsLayer when layer is hidden
  }

  /**
   * Clean up when the app is destroyed
   */
  function cleanup() {
    stopLocationServices()
    friendLocations.cleanup()
    mapEventBus.off('click:friend-marker', handleFriendMarkerClick)
    initialized = false
  }

  return {
    isLayerVisible,
    initialize,
    cleanup,
  }
}

export const useFriendLocationsLayer = createSharedComposable(friendLocationsLayerComposable)
