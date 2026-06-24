/**
 * Tracker Locations Layer Controller
 *
 * Handles tracker marker click events, navigating to the tracker detail
 * page. Mirrors the pattern from useFriendLocationsLayer — global
 * singleton that listens for map events and routes accordingly.
 */

import { createSharedComposable } from '@vueuse/core'
import { useRouter } from 'vue-router'
import { mapEventBus } from '@/lib/eventBus'
import { AppRoute } from '@/router'

function trackerLocationsLayerComposable() {
  const router = useRouter()

  let initialized = false

  function initialize() {
    if (initialized) return
    initialized = true
    mapEventBus.on('click:tracker-marker', handleTrackerMarkerClick)
  }

  function handleTrackerMarkerClick({ trackerId }: { trackerId: string }) {
    router.push({
      name: AppRoute.TRACKER_DETAIL,
      params: { id: trackerId },
    })
  }

  function cleanup() {
    mapEventBus.off('click:tracker-marker', handleTrackerMarkerClick)
    initialized = false
  }

  return {
    initialize,
    cleanup,
  }
}

export const useTrackerLocationsLayer = createSharedComposable(trackerLocationsLayerComposable)
