import { api } from '@/lib/api'
import { createSharedComposable } from '@vueuse/core'

export interface LocationShareConfig {
  id: string
  userId: string
  friendHandle: string
  enabled: boolean
  expiresAt: Date | null
}

type LocationShareConfigResponse = Omit<LocationShareConfig, 'expiresAt'> & {
  expiresAt: string | null
}

function toShareConfig(raw: LocationShareConfigResponse): LocationShareConfig {
  return { ...raw, expiresAt: raw.expiresAt ? new Date(raw.expiresAt) : null }
}

function locationService() {
  // ============================================================================
  // Location Sharing Configuration
  // ============================================================================

  /** Sharing config for every friend with an unexpired share. */
  async function getE2eeConfigs(): Promise<LocationShareConfig[]> {
    const { data } = await api.get('/location/e2ee/config')
    return (data.configs as LocationShareConfigResponse[]).map(toShareConfig)
  }

  /** Share with a friend until `expiresAt`, or until turned off when it is null. */
  async function setE2eeConfig(
    friendHandle: string,
    config: { enabled?: boolean; expiresAt?: Date | null },
  ): Promise<LocationShareConfig> {
    const { data } = await api.post('/location/e2ee/config', {
      friendHandle,
      enabled: config.enabled,
      expiresAt: config.expiresAt?.toISOString() ?? null,
    })
    return toShareConfig(data.config)
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
   * Update location: broadcast encrypted location to friends.
   *
   * Server returns per-item results: a row may be rejected because the
   * recipient isn't a friend, sharing isn't enabled, or the nonce was
   * replayed. Callers can ignore individual failures; the next
   * broadcast will catch up.
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
      results: Array<{
        friendHandle: string
        stored: boolean
        reason?: 'not-a-friend' | 'not-enabled' | 'expired' | 'replayed' | 'error'
      }>
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
