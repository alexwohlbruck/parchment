import { api } from '@/lib/api'
import { createSharedComposable } from '@vueuse/core'

function locationService() {
  // ============================================================================
  // Location Sharing Configuration
  // ============================================================================

  /**
   * Get location sharing config for all friends
   */
  async function getE2eeConfigs() {
    const { data } = await api.get('/location/e2ee/config')
    return data.configs as Array<{
      id: string
      userId: string
      friendHandle: string
      enabled: boolean
      refreshInterval: number
      expiresAt: string | null
    }>
  }

  /**
   * Set location sharing config for a friend
   */
  async function setE2eeConfig(
    friendHandle: string,
    config: {
      enabled?: boolean
      refreshInterval?: number
      expiresAt?: string
    },
  ) {
    const { data } = await api.post('/location/e2ee/config', {
      friendHandle,
      ...config,
    })
    return data.config
  }

  /**
   * Disable E2EE location sharing with a friend
   */
  async function disableE2eeSharing(friendHandle: string) {
    await api.delete(
      `/location/e2ee/config/${encodeURIComponent(friendHandle)}`,
    )
  }

  // ============================================================================
  // Location Updates
  // ============================================================================

  /**
   * Update location: broadcast encrypted location to friends
   */
  async function updateLocation(
    locations: Array<{
      forFriendHandle: string
      encryptedLocation: string
      nonce: string
    }>,
  ) {
    const { data } = await api.post('/location/e2ee/update', { locations })
    return data as {
      results: Array<{ friendHandle: string; stored: boolean }>
    }
  }

  /**
   * Get encrypted locations from friends
   */
  async function getFriendLocations() {
    const { data } = await api.get('/location/e2ee/friends')
    return data.locations as Array<{
      id: string
      fromUserId: string
      senderHandle: string
      encryptedLocation: string
      nonce: string
      updatedAt: string
    }>
  }

  return {
    // Configuration
    getE2eeConfigs,
    setE2eeConfig,
    disableE2eeSharing,

    // Location Updates
    updateLocation,
    getFriendLocations,
  }
}

export const useLocationService = createSharedComposable(locationService)
