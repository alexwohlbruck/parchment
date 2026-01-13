import { ref, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useIdentityStore } from '@/stores/identity.store'
import { useFriendsStore } from '@/stores/friends.store'
import { useLocationService } from '@/services/location.service'
import {
  encryptLocationForFriend,
  encryptLocation,
  derivePersonalKey,
  importPublicKey,
  type LocationData,
} from '@/lib/federation-crypto'
import { getSeed } from '@/lib/key-storage'

interface BroadcastConfig {
  enabled: boolean
  intervalMs: number
  includeHistory: boolean
}

/**
 * Composable for broadcasting encrypted location to friends
 * Handles encryption, broadcasting, and history storage in a single API call
 */
export function useE2eeLocationBroadcast() {
  const identityStore = useIdentityStore()
  const friendsStore = useFriendsStore()
  const locationService = useLocationService()

  const { isSetupComplete, encryptionPrivateKey } = storeToRefs(identityStore)
  const { friends } = storeToRefs(friendsStore)

  // State
  const isEnabled = ref(false)
  const isBroadcasting = ref(false)
  const lastBroadcastTime = ref<Date | null>(null)
  const broadcastError = ref<string | null>(null)
  const intervalMs = ref(60000) // Default 1 minute
  const includeHistory = ref(true)

  // Internal state
  let broadcastIntervalId: ReturnType<typeof setInterval> | null = null
  let watchPositionId: number | null = null
  let currentLocation: GeolocationPosition | null = null

  // Computed
  const friendsWithSharing = ref<
    Array<{
      friendHandle: string
      encryptionKey: string
    }>
  >([])

  /**
   * Start watching device location
   */
  function startLocationWatch() {
    if (!navigator.geolocation) {
      broadcastError.value = 'Geolocation not supported'
      return
    }

    watchPositionId = navigator.geolocation.watchPosition(
      position => {
        currentLocation = position
      },
      error => {
        console.error('Geolocation error:', error)
        broadcastError.value = `Location error: ${error.message}`
      },
      {
        enableHighAccuracy: true,
        maximumAge: 30000,
        timeout: 10000,
      },
    )
  }

  /**
   * Stop watching device location
   */
  function stopLocationWatch() {
    if (watchPositionId !== null) {
      navigator.geolocation.clearWatch(watchPositionId)
      watchPositionId = null
    }
  }

  /**
   * Load friends who have sharing enabled
   */
  async function loadFriendsWithSharing() {
    try {
      const configs = await locationService.getE2eeConfigs()
      const enabledConfigs = configs.filter(c => c.enabled)

      friendsWithSharing.value = enabledConfigs
        .map(config => {
          const friend = friends.value.find(
            f => f.friendHandle === config.friendHandle,
          )
          if (!friend?.friendEncryptionKey) return null
          return {
            friendHandle: config.friendHandle,
            encryptionKey: friend.friendEncryptionKey,
          }
        })
        .filter((f): f is NonNullable<typeof f> => f !== null)
    } catch (error) {
      console.error('Failed to load sharing configs:', error)
    }
  }

  /**
   * Broadcast current location to all friends with sharing enabled
   * Uses single API call for both friend broadcasts and personal history
   */
  async function broadcast() {
    if (!currentLocation || !encryptionPrivateKey.value) {
      return
    }

    if (friendsWithSharing.value.length === 0) {
      return
    }

    isBroadcasting.value = true
    broadcastError.value = null

    try {
      const locationData: LocationData = {
        lat: currentLocation.coords.latitude,
        lng: currentLocation.coords.longitude,
        accuracy: currentLocation.coords.accuracy ?? undefined,
        altitude: currentLocation.coords.altitude ?? undefined,
        speed: currentLocation.coords.speed ?? undefined,
        heading: currentLocation.coords.heading ?? undefined,
        timestamp: currentLocation.timestamp,
      }

      // Encrypt location for each friend
      const encryptedLocations: Array<{
        forFriendHandle: string
        encryptedLocation: string
        nonce: string
      }> = []

      for (const friend of friendsWithSharing.value) {
        try {
          const friendPublicKey = importPublicKey(friend.encryptionKey)
          const encrypted = encryptLocationForFriend(
            locationData,
            encryptionPrivateKey.value,
            friendPublicKey,
          )

          encryptedLocations.push({
            forFriendHandle: friend.friendHandle,
            encryptedLocation: encrypted.ciphertext,
            nonce: encrypted.nonce,
          })
        } catch (error) {
          console.error(`Failed to encrypt for ${friend.friendHandle}:`, error)
        }
      }

      // Prepare history encryption if enabled
      let historyData:
        | { encryptedLocation: string; nonce: string; timestamp: Date }
        | undefined

      if (includeHistory.value) {
        try {
          const seed = await getSeed()
          if (seed) {
            const personalKey = derivePersonalKey(seed)
            const encrypted = encryptLocation(locationData, personalKey)
            historyData = {
              encryptedLocation: encrypted.ciphertext,
              nonce: encrypted.nonce,
              timestamp: new Date(locationData.timestamp),
            }
          }
        } catch (error) {
          console.error('Failed to encrypt history:', error)
        }
      }

      // Single API call for both broadcast and history
      if (encryptedLocations.length > 0) {
        await locationService.updateLocation(encryptedLocations, historyData)
      }

      lastBroadcastTime.value = new Date()
    } catch (error) {
      console.error('Broadcast failed:', error)
      broadcastError.value =
        error instanceof Error ? error.message : 'Broadcast failed'
    } finally {
      isBroadcasting.value = false
    }
  }

  /**
   * Start broadcasting
   */
  async function start(config?: Partial<BroadcastConfig>) {
    if (!isSetupComplete.value) {
      broadcastError.value = 'Identity not set up'
      return
    }

    if (config?.intervalMs) intervalMs.value = config.intervalMs
    if (config?.includeHistory !== undefined)
      includeHistory.value = config.includeHistory

    await loadFriendsWithSharing()
    startLocationWatch()

    // Initial broadcast after a short delay to get location
    setTimeout(() => broadcast(), 5000)

    // Set up interval
    broadcastIntervalId = setInterval(async () => {
      // Reload friends with sharing in case configs changed
      await loadFriendsWithSharing()
      await broadcast()
    }, intervalMs.value)

    isEnabled.value = true
  }

  /**
   * Stop broadcasting
   */
  function stop() {
    stopLocationWatch()

    if (broadcastIntervalId) {
      clearInterval(broadcastIntervalId)
      broadcastIntervalId = null
    }

    isEnabled.value = false
  }

  /**
   * Force a broadcast now
   */
  async function broadcastNow() {
    if (!isEnabled.value) {
      await start()
    }
    await broadcast()
  }

  /**
   * Update interval
   */
  function updateInterval(ms: number) {
    intervalMs.value = ms
    if (isEnabled.value) {
      stop()
      start({ intervalMs: ms })
    }
  }

  // Cleanup on unmount
  onUnmounted(() => {
    stop()
  })

  /**
   * Refresh sharing config and broadcast immediately
   * Called when location sharing is toggled in the UI
   */
  async function refreshAndBroadcast() {
    await loadFriendsWithSharing()
    if (isEnabled.value && friendsWithSharing.value.length > 0) {
      await broadcast()
    }
  }

  return {
    // State
    isEnabled,
    isBroadcasting,
    lastBroadcastTime,
    broadcastError,
    intervalMs,
    includeHistory,
    friendsWithSharing,

    // Actions
    start,
    stop,
    broadcastNow,
    updateInterval,
    loadFriendsWithSharing,
    refreshAndBroadcast,
  }
}
