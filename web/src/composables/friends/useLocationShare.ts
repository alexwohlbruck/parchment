import { ref } from 'vue'
import { useLocationService } from '@/services/location.service'
import { useE2eeLocationBroadcast } from '@/composables/friends/useE2eeLocationBroadcast'
import { appEventBus } from '@/lib/event-bus'
import {
  shareExpiry,
  type LocationShareState,
  type ShareDuration,
} from '@/lib/friends/share-duration'

/** Start, change or stop sharing this device's location with one friend. */
export function useLocationShare() {
  const locationService = useLocationService()
  const locationBroadcast = useE2eeLocationBroadcast()
  const savingHandle = ref<string | null>(null)

  async function apply(
    friendHandle: string,
    save: () => Promise<LocationShareState>,
  ): Promise<LocationShareState> {
    savingHandle.value = friendHandle
    try {
      const state = await save()
      await locationBroadcast.refreshAndBroadcast()
      appEventBus.emit('location-config:changed', { friendHandle, ...state })
      return state
    } finally {
      savingHandle.value = null
    }
  }

  function share(friendHandle: string, duration: ShareDuration) {
    return apply(friendHandle, async () => {
      const config = await locationService.setE2eeConfig(friendHandle, {
        enabled: true,
        expiresAt: shareExpiry(duration),
      })
      return { enabled: true, expiresAt: config.expiresAt }
    })
  }

  function stopSharing(friendHandle: string) {
    return apply(friendHandle, async () => {
      await locationService.disableE2eeSharing(friendHandle)
      return { enabled: false, expiresAt: null }
    })
  }

  return { savingHandle, share, stopSharing }
}
