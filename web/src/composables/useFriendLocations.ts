/**
 * Friend Locations Composable
 *
 * Fetches encrypted locations from friends, decrypts them,
 * and provides reactive state for map display.
 */

import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { createSharedComposable } from '@vueuse/core'
import { useLocationService } from '@/services/location.service'
import { useFriendsStore } from '@/stores/friends.store'
import { useIdentityStore } from '@/stores/identity.store'
import {
  decryptLocationFromFriend,
  importPublicKey,
  type LocationData,
} from '@/lib/federation-crypto'
import type { LngLat } from '@/types/map.types'

export interface FriendLocation {
  friendHandle: string
  friendAlias: string
  friendName?: string
  friendPicture?: string
  location: LocationData
  updatedAt: Date
  lngLat: LngLat
}

function friendLocationsComposable() {
  const locationService = useLocationService()
  const friendsStore = useFriendsStore()
  const identityStore = useIdentityStore()

  const { friends } = storeToRefs(friendsStore)
  const { encryptionPrivateKey, isSetupComplete } = storeToRefs(identityStore)

  // State
  const friendLocations = ref<Map<string, FriendLocation>>(new Map())
  const isLoading = ref(false)
  const lastFetchedAt = ref<Date | null>(null)
  const error = ref<string | null>(null)
  const isPolling = ref(false)
  let pollInterval: ReturnType<typeof setInterval> | null = null

  // Computed
  const locations = computed(() => Array.from(friendLocations.value.values()))
  const hasLocations = computed(() => friendLocations.value.size > 0)

  /**
   * Fetch and decrypt friend locations from the server
   */
  async function fetchLocations(): Promise<FriendLocation[]> {
    if (!isSetupComplete.value || !encryptionPrivateKey.value) {
      console.warn('Identity not set up, cannot fetch friend locations')
      return []
    }

    isLoading.value = true
    error.value = null

    try {
      // Fetch encrypted locations from server
      const encryptedLocations = await locationService.getFriendLocations()

      if (!encryptedLocations || encryptedLocations.length === 0) {
        return Array.from(friendLocations.value.values())
      }

      const decryptedLocations: FriendLocation[] = []
      const processedHandles = new Set<string>()

      for (const encLoc of encryptedLocations) {
        try {
          // Find the friend who sent this location using senderHandle
          const friend = friends.value.find(
            f => f.friendHandle === encLoc.senderHandle,
          )

          if (!friend) {
            console.warn(
              `Could not find friend for sender handle: ${encLoc.senderHandle}`,
            )
            continue
          }

          if (!friend.friendEncryptionKey) {
            console.warn(
              `Friend ${friend.friendHandle} has no encryption key, skipping`,
            )
            continue
          }

          // Decrypt the location
          const friendPublicKey = importPublicKey(friend.friendEncryptionKey)
          const locationData = decryptLocationFromFriend(
            encLoc.encryptedLocation,
            encLoc.nonce,
            encryptionPrivateKey.value,
            friendPublicKey,
          )

          const friendLocation: FriendLocation = {
            friendHandle: friend.friendHandle,
            friendAlias: friend.friendHandle.split('@')[0],
            friendName: friend.friendName || undefined,
            friendPicture: friend.friendPicture || undefined,
            location: locationData,
            updatedAt: new Date(encLoc.updatedAt),
            lngLat: {
              lat: locationData.lat,
              lng: locationData.lng,
            },
          }

          decryptedLocations.push(friendLocation)
          friendLocations.value.set(friend.friendHandle, friendLocation)
          processedHandles.add(friend.friendHandle)
        } catch (decryptError) {
          const handle = encLoc.senderHandle
          console.warn(
            `Failed to decrypt location for ${handle}:`,
            decryptError,
          )
          // On decryption failure, try syncing keys for next time
          // but don't block or retry aggressively
        }
      }

      // Remove locations for friends no longer in the friends list
      const currentFriendHandles = new Set(
        friends.value.map(f => f.friendHandle),
      )
      for (const [handle] of friendLocations.value.entries()) {
        if (!currentFriendHandles.has(handle)) {
          friendLocations.value.delete(handle)
        }
      }

      lastFetchedAt.value = new Date()
      return decryptedLocations
    } catch (err) {
      console.error('Failed to fetch friend locations:', err)
      error.value = err instanceof Error ? err.message : 'Failed to fetch'
      return []
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Start polling for friend locations
   * @param intervalMs - Polling interval in milliseconds (default: 30 seconds)
   */
  function startPolling(intervalMs: number = 30000) {
    if (isPolling.value) return

    isPolling.value = true
    fetchLocations() // Initial fetch

    pollInterval = setInterval(() => {
      fetchLocations()
    }, intervalMs)
  }

  /**
   * Stop polling for friend locations
   */
  function stopPolling() {
    if (pollInterval) {
      clearInterval(pollInterval)
      pollInterval = null
    }
    isPolling.value = false
  }

  /**
   * Clear all cached locations
   */
  function clearLocations() {
    friendLocations.value.clear()
    lastFetchedAt.value = null
  }

  /**
   * Get location for a specific friend
   */
  function getLocationForFriend(
    friendHandle: string,
  ): FriendLocation | undefined {
    return friendLocations.value.get(friendHandle)
  }

  // Clean up on unmount
  function cleanup() {
    stopPolling()
    clearLocations()
  }

  return {
    // State
    friendLocations,
    locations,
    hasLocations,
    isLoading,
    isPolling,
    lastFetchedAt,
    error,

    // Actions
    fetchLocations,
    startPolling,
    stopPolling,
    clearLocations,
    getLocationForFriend,
    cleanup,
  }
}

export const useFriendLocations = createSharedComposable(
  friendLocationsComposable,
)
