import { ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { createSharedComposable } from '@vueuse/core'
import { useIdentityStore } from '@/stores/identity.store'
import { useFriendsStore } from '@/stores/friends.store'
import { useLocationService } from '@/services/location.service'
import { useGeolocationService } from '@/services/geolocation.service'
import {
  buildRelationshipId,
  encryptLocationForFriendV2,
  importPublicKey,
  type FriendShareBinding,
  type LocationData,
} from '@/lib/federation-crypto'

// Broadcast cadence is driven by GPS movement, not a fixed timer. Three
// gates keep traffic sane:
//
//   - MIN_BROADCAST_INTERVAL_MS: floor between consecutive broadcasts so
//     GPS jitter (sub-second updates with tiny accuracy wobble) doesn't
//     fan out a request storm.
//   - MIN_DISTANCE_M: ignore movement smaller than this; GPS noise can
//     report a few meters of drift while the device is still on a desk.
//   - STATIONARY_REFRESH_MS: even if neither gate trips, broadcast at
//     least this often so receivers see a fresh `updatedAt` and battery
//     info — proof the marker is still alive.
//
// HEARTBEAT_MS drives a low-frequency timer that re-evaluates the gates
// even when the geolocation watcher hasn't fired (OS suspended GPS,
// background tab on mobile). Without it, a stationary device would
// never trip the stationary refresh because no coord change would wake
// the broadcast trigger.
const MIN_BROADCAST_INTERVAL_MS = 10_000
const MIN_DISTANCE_M = 10
const STATIONARY_REFRESH_MS = 5 * 60_000
const HEARTBEAT_MS = 60_000

/**
 * Equirectangular distance in meters between two lat/lng pairs. Accurate
 * enough at the 10 m threshold we care about and avoids the cost of a
 * full haversine. We never compare points more than a kilometer apart in
 * this code path.
 */
function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const x = (toRad(b.lng) - toRad(a.lng)) * Math.cos(toRad((a.lat + b.lat) / 2))
  const y = toRad(b.lat) - toRad(a.lat)
  return Math.sqrt(x * x + y * y) * R
}

/**
 * Composable for broadcasting encrypted location to friends. SHARED via
 * `createSharedComposable` — every caller across the app sees the same
 * watcher, broadcast loop, and state. The location feature has many
 * touch points (FriendsList, LocationSharingSettings, FriendDetail,
 * map layer controller); without sharing, each component would spin up
 * its own GPS watcher and POST independently.
 *
 * Broadcast is driven by `geolocation.coords` updates plus a low-rate
 * heartbeat tick (so stationary devices still refresh). The receive
 * path is realtime websocket push; see `useFriendLocations.realtime.ts`.
 */
function e2eeLocationBroadcastComposable() {
  const identityStore = useIdentityStore()
  const friendsStore = useFriendsStore()
  const locationService = useLocationService()
  const geolocation = useGeolocationService()

  const { isSetupComplete, encryptionPrivateKey, signingPrivateKey, handle } =
    storeToRefs(identityStore)
  const { friends } = storeToRefs(friendsStore)

  // State
  const isEnabled = ref(false)
  const isBroadcasting = ref(false)
  const lastBroadcastTime = ref<Date | null>(null)
  const broadcastError = ref<string | null>(null)

  // Internal state
  let stopLocationWatch: (() => void) | null = null
  let heartbeatId: ReturnType<typeof setInterval> | null = null
  let currentLocation: GeolocationPosition | null = null
  let lastBroadcastPosition: { lat: number; lng: number } | null = null
  let batteryManager: BatteryManager | null = null

  // Battery Manager type (not in all TypeScript libs)
  interface BatteryManager extends EventTarget {
    charging: boolean
    chargingTime: number
    dischargingTime: number
    level: number
  }

  async function initBatteryMonitor() {
    try {
      if ('getBattery' in navigator) {
        batteryManager = await (navigator as any).getBattery()
      }
    } catch (error) {
      console.warn('Battery API not available:', error)
    }
  }

  function getBatteryInfo(): { level: number; charging: boolean } | undefined {
    if (batteryManager) {
      return { level: batteryManager.level, charging: batteryManager.charging }
    }
    return undefined
  }

  const friendsWithSharing = ref<
    Array<{
      friendHandle: string
      encryptionKey: string
    }>
  >([])

  /**
   * Decide whether the latest coords should trigger a broadcast. First
   * coord after `start()` always broadcasts (cold-start UX); subsequent
   * coords must clear the time floor AND either move enough or have
   * triggered the stationary refresh.
   */
  function shouldBroadcast(coords: { lat: number; lng: number }): boolean {
    if (!isEnabled.value) return false
    // Single in-flight broadcast at a time. Encrypt+POST can take seconds
    // on a long friends list and a second concurrent run would update
    // last-broadcast bookkeeping out of order.
    if (isBroadcasting.value) return false
    if (!lastBroadcastTime.value || !lastBroadcastPosition) return true

    const elapsed = Date.now() - lastBroadcastTime.value.getTime()
    if (elapsed < MIN_BROADCAST_INTERVAL_MS) return false

    if (elapsed >= STATIONARY_REFRESH_MS) return true
    return distanceMeters(lastBroadcastPosition, coords) >= MIN_DISTANCE_M
  }

  /**
   * Watch the device location. Two responsibilities: keep
   * `currentLocation` fresh so `broadcast()` always reads the latest
   * fix, and trigger a broadcast when the gates allow it.
   */
  function startLocationWatch() {
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
          coords: {
            latitude: coords.latitude,
            longitude: coords.longitude,
            accuracy: coords.accuracy,
            altitude: coords.altitude,
            altitudeAccuracy: coords.altitudeAccuracy,
            heading: coords.heading,
            speed: coords.speed,
          },
          timestamp: Date.now(),
        } as GeolocationPosition

        if (shouldBroadcast({ lat: coords.latitude, lng: coords.longitude })) {
          void broadcast()
        }
      },
      { immediate: true },
    )
  }

  /**
   * Heartbeat tick. Re-evaluates the broadcast gates against the last
   * known position, even if no coord change has fired (OS suspended GPS,
   * background tab on mobile). The gates themselves are unchanged — this
   * is just a wake-up.
   */
  function startHeartbeat() {
    if (heartbeatId) return
    heartbeatId = setInterval(() => {
      if (!currentLocation) return
      const coords = {
        lat: currentLocation.coords.latitude,
        lng: currentLocation.coords.longitude,
      }
      if (shouldBroadcast(coords)) {
        void broadcast()
      }
    }, HEARTBEAT_MS)
  }

  function stopHeartbeat() {
    if (heartbeatId) {
      clearInterval(heartbeatId)
      heartbeatId = null
    }
  }

  async function loadFriendsWithSharing() {
    try {
      const configs = await locationService.getE2eeConfigs()
      const enabledConfigs = configs.filter((c) => c.enabled)

      friendsWithSharing.value = enabledConfigs
        .map((config) => {
          const handle = config.friendHandle.toLowerCase()
          const friend = friends.value.find(
            (f) => f.friendHandle.toLowerCase() === handle,
          )
          if (!friend?.friendEncryptionKey) return null
          return {
            friendHandle: friend.friendHandle,
            encryptionKey: friend.friendEncryptionKey,
          }
        })
        .filter((f): f is NonNullable<typeof f> => f !== null)
    } catch (error) {
      console.error('Failed to load sharing configs:', error)
    }
  }

  /**
   * Broadcast current location to all friends with sharing enabled.
   *
   * Guards: returns early (without throwing) if anything required is
   * missing. Always advances `lastBroadcastTime` so `shouldBroadcast`
   * doesn't retry-spam on every coord update when there's nothing to
   * send.
   */
  async function broadcast() {
    if (
      !currentLocation ||
      !encryptionPrivateKey.value ||
      !signingPrivateKey.value ||
      !handle.value
    ) {
      return
    }

    // Re-entrancy guard. `shouldBroadcast` already checks this, but a
    // second caller (e.g. `broadcastNow`) bypasses the gates.
    if (isBroadcasting.value) return

    if (friendsWithSharing.value.length === 0) {
      // Nothing to send, but advance the bookkeeping so the watcher
      // doesn't call us back on every single coord update.
      lastBroadcastTime.value = new Date()
      lastBroadcastPosition = {
        lat: currentLocation.coords.latitude,
        lng: currentLocation.coords.longitude,
      }
      return
    }

    isBroadcasting.value = true
    broadcastError.value = null

    try {
      const batteryInfo = getBatteryInfo()
      const locationData: LocationData = {
        lat: currentLocation.coords.latitude,
        lng: currentLocation.coords.longitude,
        accuracy: currentLocation.coords.accuracy ?? undefined,
        altitude: currentLocation.coords.altitude ?? undefined,
        altitudeAccuracy: currentLocation.coords.altitudeAccuracy ?? undefined,
        speed: currentLocation.coords.speed ?? undefined,
        heading: currentLocation.coords.heading ?? undefined,
        battery: batteryInfo?.level,
        batteryCharging: batteryInfo?.charging,
        timestamp: currentLocation.timestamp,
      }

      // v2 wire shape: `encryptedLocation` carries the ECIES blob base64;
      // `nonce` is repurposed to carry the RFC 3339 sentAt timestamp that
      // the AAD binds (receivers recompute AAD using this value). The old
      // AES-GCM nonce now lives inside the v2 envelope.
      const encryptedLocations: Array<{
        forFriendHandle: string
        encryptedLocation: string
        nonce: string
      }> = []

      const senderHandle = handle.value
      const signingPriv = signingPrivateKey.value

      for (const friend of friendsWithSharing.value) {
        try {
          const sentAt = new Date().toISOString()
          const binding: FriendShareBinding = {
            senderId: senderHandle,
            recipientId: friend.friendHandle,
            relationshipId: buildRelationshipId(
              senderHandle,
              friend.friendHandle,
            ),
            timestamp: sentAt,
          }
          const friendPublicKey = importPublicKey(friend.encryptionKey)
          const blob = await encryptLocationForFriendV2({
            location: locationData,
            mySigningPrivateKey: signingPriv,
            friendEncryptionPublicKey: friendPublicKey,
            binding,
          })

          encryptedLocations.push({
            forFriendHandle: friend.friendHandle,
            encryptedLocation: blob,
            nonce: sentAt,
          })
        } catch (error) {
          console.error(`Failed to encrypt for ${friend.friendHandle}:`, error)
        }
      }

      if (encryptedLocations.length > 0) {
        await locationService.updateLocation(encryptedLocations)
      }

      lastBroadcastTime.value = new Date()
      lastBroadcastPosition = {
        lat: currentLocation.coords.latitude,
        lng: currentLocation.coords.longitude,
      }
    } catch (error) {
      console.error('Broadcast failed:', error)
      broadcastError.value =
        error instanceof Error ? error.message : 'Broadcast failed'
    } finally {
      isBroadcasting.value = false
    }
  }

  async function start() {
    if (!isSetupComplete.value) {
      broadcastError.value = 'Identity not set up'
      return
    }

    await loadFriendsWithSharing()
    await initBatteryMonitor()

    isEnabled.value = true
    startLocationWatch()
    startHeartbeat()
  }

  function stop() {
    stopLocationWatch?.()
    stopLocationWatch = null
    stopHeartbeat()
    isEnabled.value = false
    lastBroadcastPosition = null
    lastBroadcastTime.value = null
  }

  async function broadcastNow() {
    if (!isEnabled.value) {
      await start()
    }
    await broadcast()
  }

  /**
   * Refresh sharing config and broadcast immediately. Called when
   * location sharing is toggled in the UI.
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
    friendsWithSharing,

    // Actions
    start,
    stop,
    broadcastNow,
    loadFriendsWithSharing,
    refreshAndBroadcast,
  }
}

export const useE2eeLocationBroadcast = createSharedComposable(
  e2eeLocationBroadcastComposable,
)
