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
   * Update location: broadcast to friends and optionally store in history
   * Single API call for all location updates
   */
  async function updateLocation(
    locations: Array<{
      forFriendHandle: string
      encryptedLocation: string
      nonce: string
    }>,
    history?: {
      encryptedLocation: string
      nonce: string
      timestamp: Date
    },
  ) {
    const { data } = await api.post('/location/e2ee/update', {
      locations,
      history: history
        ? {
            encryptedLocation: history.encryptedLocation,
            nonce: history.nonce,
            timestamp: history.timestamp.toISOString(),
          }
        : undefined,
    })
    return data as {
      results: Array<{ friendHandle: string; stored: boolean }>
      historyId: string | null
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

  // ============================================================================
  // Location History
  // ============================================================================

  /**
   * Get encrypted location history
   */
  async function getE2eeHistory(limit?: number) {
    const { data } = await api.get('/location/e2ee/history', {
      params: { limit },
    })
    return data.entries as Array<{
      id: string
      encryptedLocation: string
      nonce: string
      timestamp: string
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

    // History
    getE2eeHistory,
  }
}

export const useLocationService = createSharedComposable(locationService)
