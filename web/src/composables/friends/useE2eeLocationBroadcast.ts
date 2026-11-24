import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { createSharedComposable } from '@vueuse/core'
import { useIdentityStore } from '@/stores/identity.store'
import { useFriendsStore } from '@/stores/friends.store'
import { useFriendKeyPinsStore } from '@/stores/friends/friend-key-pins.store'
import { useLocationService } from '@/services/location.service'
import { useGeolocationService } from '@/services/geolocation.service'
import { haversineMeters } from '@/lib/geo/geo-line'
import {
  BROADCAST_HEARTBEAT_MS,
  MAX_RESEND_FIX_AGE_MS,
  MIN_BROADCAST_DISTANCE_M,
  MIN_BROADCAST_INTERVAL_MS,
  STATIONARY_REFRESH_MS,
  broadcastBackoffMs,
} from '@/lib/friends/friend-location'
import {
  buildRelationshipId,
  encryptLocationForFriendV2,
  importPublicKey,
  type FriendShareBinding,
  type LocationData,
} from '@/lib/identity/federation-crypto'

interface BatteryManager extends EventTarget {
  charging: boolean
  level: number
}

/**
 * Broadcasts this device's encrypted location to every friend it is shared
 * with. Shared, so the app has one GPS watch and one broadcast loop.
 *
 * Runs whenever it has been activated, the identity is ready and at least
 * one friend has sharing on — independent of whether the friends layer is
 * drawn. Broadcasts follow movement, with a heartbeat for stationary devices.
 */
function e2eeLocationBroadcastComposable() {
  const identityStore = useIdentityStore()
  const friendsStore = useFriendsStore()
  const pinsStore = useFriendKeyPinsStore()
  const locationService = useLocationService()
  const geolocation = useGeolocationService()

  const { isSetupComplete, signingPrivateKey, handle } = storeToRefs(identityStore)
  const { friends } = storeToRefs(friendsStore)

  const isEnabled = ref(false)
  const isBroadcasting = ref(false)
  const lastBroadcastTime = ref<Date | null>(null)
  const broadcastError = ref<string | null>(null)
  const sharedHandles = ref<Set<string>>(new Set())
  const isActive = ref(false)

  let stopLocationWatch: (() => void) | null = null
  let heartbeatId: ReturnType<typeof setInterval> | null = null
  let configPollId: ReturnType<typeof setInterval> | null = null
  let currentLocation: Omit<LocationData, 'battery' | 'batteryCharging'> | null = null
  let lastBroadcastPosition: { lat: number; lng: number } | null = null
  let batteryManager: BatteryManager | null = null
  let failures = 0
  let retryAt = 0
  // Bumped by stop() so a start() still awaiting can tell it was cancelled.
  let generation = 0

  const friendsWithSharing = computed(() =>
    friends.value.filter(
      (f) =>
        sharedHandles.value.has(f.friendHandle.toLowerCase()) &&
        !!f.friendEncryptionKey &&
        !!f.friendSigningKey,
    ),
  )

  const shouldRun = computed(
    () => isActive.value && isSetupComplete.value && sharedHandles.value.size > 0,
  )

  async function initBatteryMonitor() {
    if (batteryManager || !('getBattery' in navigator)) return
    try {
      batteryManager = await (navigator as any).getBattery()
    } catch {
      batteryManager = null
    }
  }

  async function loadFriendsWithSharing() {
    if (!isActive.value) return
    try {
      const configs = await locationService.getE2eeConfigs()
      sharedHandles.value = new Set(
        configs.filter((c) => c.enabled).map((c) => c.friendHandle.toLowerCase()),
      )
    } catch (error) {
      console.error('Failed to load sharing configs:', error)
    }
  }

  function shouldBroadcast(coords: { lat: number; lng: number }): boolean {
    if (!isEnabled.value || isBroadcasting.value) return false
    const now = Date.now()
    if (now < retryAt) return false
    if (!lastBroadcastTime.value || !lastBroadcastPosition) return true

    const elapsed = now - lastBroadcastTime.value.getTime()
    if (elapsed < MIN_BROADCAST_INTERVAL_MS) return false
    if (elapsed >= STATIONARY_REFRESH_MS) return true
    const { lat, lng } = lastBroadcastPosition
    return haversineMeters(lat, lng, coords.lat, coords.lng) >= MIN_BROADCAST_DISTANCE_M
  }

  function startLocationWatch() {
    stopLocationWatch?.()
    if (!geolocation.isSupported.value) {
      broadcastError.value = 'Geolocation not supported'
      return
    }

    geolocation.resume()

    stopLocationWatch = watch(
      geolocation.coords,
      (coords) => {
        if (coords.latitude === Infinity) return
        currentLocation = {
          lat: coords.latitude,
          lng: coords.longitude,
          accuracy: coords.accuracy ?? undefined,
          altitude: coords.altitude ?? undefined,
          altitudeAccuracy: coords.altitudeAccuracy ?? undefined,
          heading: coords.heading ?? undefined,
          speed: coords.speed ?? undefined,
          timestamp: geolocation.locatedAt.value ?? Date.now(),
        }
        if (shouldBroadcast(currentLocation)) void broadcast()
      },
      { immediate: true },
    )
  }

  function startHeartbeat() {
    if (heartbeatId) return
    heartbeatId = setInterval(() => {
      if (!currentLocation) return
      if (Date.now() - currentLocation.timestamp > MAX_RESEND_FIX_AGE_MS) return
      if (shouldBroadcast(currentLocation)) void broadcast()
    }, BROADCAST_HEARTBEAT_MS)
  }

  function stopHeartbeat() {
    if (!heartbeatId) return
    clearInterval(heartbeatId)
    heartbeatId = null
  }

  function markBroadcast(location: { lat: number; lng: number }) {
    lastBroadcastTime.value = new Date()
    lastBroadcastPosition = { lat: location.lat, lng: location.lng }
  }

  async function encryptFor(
    friend: (typeof friendsWithSharing.value)[number],
    location: LocationData,
    senderHandle: string,
    signingPriv: Uint8Array,
  ) {
    const keys = await pinsStore.trustedKeys(friend)
    if (!keys) return null
    const sentAt = new Date().toISOString()
    const binding: FriendShareBinding = {
      senderId: senderHandle,
      recipientId: friend.friendHandle,
      relationshipId: buildRelationshipId(senderHandle, friend.friendHandle),
      timestamp: sentAt,
    }
    const blob = await encryptLocationForFriendV2({
      location,
      mySigningPrivateKey: signingPriv,
      friendEncryptionPublicKey: importPublicKey(keys.encryptionKey),
      binding,
    })
    // `nonce` carries the sentAt timestamp the AAD binds.
    return { forFriendHandle: friend.friendHandle, encryptedLocation: blob, nonce: sentAt }
  }

  async function broadcast() {
    const location = currentLocation
    const senderHandle = handle.value
    const signingPriv = signingPrivateKey.value
    if (!location || !senderHandle || !signingPriv || isBroadcasting.value) return

    const recipients = friendsWithSharing.value
    if (recipients.length === 0) {
      markBroadcast(location)
      return
    }

    isBroadcasting.value = true
    broadcastError.value = null
    try {
      const locationData: LocationData = {
        ...location,
        battery: batteryManager?.level,
        batteryCharging: batteryManager?.charging,
      }
      const encrypted: NonNullable<Awaited<ReturnType<typeof encryptFor>>>[] = []
      for (const friend of recipients) {
        try {
          const row = await encryptFor(friend, locationData, senderHandle, signingPriv)
          if (row) encrypted.push(row)
        } catch (error) {
          console.error(`Failed to encrypt for ${friend.friendHandle}:`, error)
        }
      }
      if (encrypted.length > 0) await locationService.updateLocation(encrypted)
      markBroadcast(location)
      failures = 0
      retryAt = 0
    } catch (error) {
      failures += 1
      retryAt = Date.now() + broadcastBackoffMs(failures)
      broadcastError.value = error instanceof Error ? error.message : 'Broadcast failed'
    } finally {
      isBroadcasting.value = false
    }
  }

  async function start() {
    if (!isSetupComplete.value) {
      broadcastError.value = 'Identity not set up'
      return
    }
    const myGeneration = ++generation
    if (sharedHandles.value.size === 0) await loadFriendsWithSharing()
    await initBatteryMonitor()
    if (myGeneration !== generation) return

    isEnabled.value = true
    startLocationWatch()
    startHeartbeat()
  }

  function stop() {
    generation += 1
    stopLocationWatch?.()
    stopLocationWatch = null
    stopHeartbeat()
    isEnabled.value = false
    lastBroadcastPosition = null
    lastBroadcastTime.value = null
    failures = 0
    retryAt = 0
  }

  watch(shouldRun, (run) => {
    if (run && !isEnabled.value) void start()
    else if (!run && isEnabled.value) stop()
  })

  /** Begin following the sharing settings. Call once the user is signed in. */
  async function activate() {
    isActive.value = true
    // Sharing can be changed from another device, which sends no event here.
    configPollId ??= setInterval(() => {
      void loadFriendsWithSharing()
    }, STATIONARY_REFRESH_MS)
    await loadFriendsWithSharing()
  }

  /** Stop broadcasting and forget this account's sharing settings. */
  function deactivate() {
    isActive.value = false
    if (configPollId) clearInterval(configPollId)
    configPollId = null
    stop()
    sharedHandles.value = new Set()
    currentLocation = null
  }

  async function broadcastNow() {
    if (!isEnabled.value) await start()
    await broadcast()
  }

  /** Re-read sharing settings and send a fresh location to anyone newly added. */
  async function refreshAndBroadcast() {
    await loadFriendsWithSharing()
    if (isEnabled.value && friendsWithSharing.value.length > 0) await broadcast()
  }

  return {
    isEnabled,
    isBroadcasting,
    lastBroadcastTime,
    broadcastError,
    friendsWithSharing,
    start,
    stop,
    activate,
    deactivate,
    broadcastNow,
    loadFriendsWithSharing,
    refreshAndBroadcast,
  }
}

export const useE2eeLocationBroadcast = createSharedComposable(
  e2eeLocationBroadcastComposable,
)
