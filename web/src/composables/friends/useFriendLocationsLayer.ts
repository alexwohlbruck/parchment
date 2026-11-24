/**
 * Friend Locations Layer Controller
 *
 * Manages the friend-locations feature globally: hydrates state when the
 * map layer becomes visible and keeps the broadcaster following the
 * sharing settings. Realtime push of friends' locations is handled by
 * `useFriendLocations.realtime.ts` regardless of layer visibility.
 */

import { watch, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { createSharedComposable } from '@vueuse/core'
import { useRouter } from 'vue-router'
import { useLayersStore } from '@/stores/layers.store'
import { useIdentityStore } from '@/stores/identity.store'
import { useFriendsStore } from '@/stores/friends.store'
import { useFriendLocations } from '@/composables/friends/useFriendLocations'
import { useE2eeLocationBroadcast } from '@/composables/friends/useE2eeLocationBroadcast'
import { useMapService } from '@/services/map/map.service'
import { mapEventBus } from '@/lib/event-bus'
import { AppRoute } from '@/router'

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
  let stopWatchers: (() => void) | null = null

  /**
   * Start the friend-locations feature for the signed-in user. Broadcasting
   * follows the sharing settings; the layer only controls what is drawn.
   */
  async function initialize() {
    if (initialized) return
    initialized = true

    mapEventBus.on('click:friend-marker', handleFriendMarkerClick)
    const stopVisible = watch(isLayerVisible, (visible) => {
      if (visible && isSetupComplete.value) void hydrate()
    })
    const stopSetup = watch(isSetupComplete, (complete) => {
      if (!complete) return
      void locationBroadcast.activate()
      if (isLayerVisible.value) void hydrate()
    })
    stopWatchers = () => {
      stopVisible()
      stopSetup()
    }

    try {
      await identityStore.initialize()
      await friendsStore.loadAll()
    } catch (err) {
      console.warn('[friend-locations] initial load failed', err)
    }
    if (!initialized || !isSetupComplete.value) return
    void locationBroadcast.activate()
    if (isLayerVisible.value) void hydrate()
  }

  function handleFriendMarkerClick({ friendHandle }: { friendHandle: string }) {
    router.push({
      name: AppRoute.FRIEND_DETAIL,
      params: { handle: friendHandle },
    })
  }

  async function hydrate() {
    await friendsStore.syncKeys()
    await friendLocations.fetchLocations()
  }

  /** Tear down everything held for the signed-in user. */
  function cleanup() {
    stopWatchers?.()
    stopWatchers = null
    locationBroadcast.deactivate()
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
