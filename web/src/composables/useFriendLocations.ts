/**
 * Friend Locations Composable
 *
 * Holds reactive state for friends' decrypted positions. State is fed
 * three ways:
 *
 *   - `fetchLocations()` for initial hydration when the layer mounts
 *     and for catch-up after a websocket reconnect. Sweeps stale entries
 *     out (anyone present locally but missing from the response).
 *   - `applyEncryptedLocation(encLoc)` for individual server-pushed
 *     `location:updated` events.
 *   - `removeLocation(senderHandle)` for `location:cleared` events
 *     (sender disabled sharing or unfriended).
 *
 * All three funnel through the same map keyed by lowercased handle so
 * comparisons are case-insensitive end to end.
 */

import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { createSharedComposable } from '@vueuse/core'
import { useLocationService } from '@/services/location.service'
import { useFriendsStore } from '@/stores/friends.store'
import { useIdentityStore } from '@/stores/identity.store'
import {
  buildRelationshipId,
  decryptLocationFromFriendV2,
  importPublicKey,
  type FriendShareBinding,
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

export interface EncryptedLocationPayload {
  id: string
  fromUserId: string
  senderHandle: string | null
  encryptedLocation: string
  nonce: string
  updatedAt: string
}

export interface LocationClearedPayload {
  senderHandle: string
}

/**
 * Type guard: confirm an unknown realtime payload has the shape we expect
 * before we hand it to decrypt. The realtime envelope is unvalidated by
 * design — schema-checking here turns a malformed server emit into a
 * silent no-op instead of a runtime crash inside crypto code.
 */
export function isEncryptedLocationPayload(
  v: unknown,
): v is EncryptedLocationPayload {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    typeof o.fromUserId === 'string' &&
    (o.senderHandle === null || typeof o.senderHandle === 'string') &&
    typeof o.encryptedLocation === 'string' &&
    typeof o.nonce === 'string' &&
    typeof o.updatedAt === 'string'
  )
}

export function isLocationClearedPayload(
  v: unknown,
): v is LocationClearedPayload {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.senderHandle === 'string'
}

function friendLocationsComposable() {
  const locationService = useLocationService()
  const friendsStore = useFriendsStore()
  const identityStore = useIdentityStore()

  const { friends } = storeToRefs(friendsStore)
  const { encryptionPrivateKey, isSetupComplete, handle: myHandle } =
    storeToRefs(identityStore)

  // Map keys are LOWERCASED handles so all reads/writes/deletes are
  // case-insensitive without callers needing to think about it.
  const friendLocations = ref<Map<string, FriendLocation>>(new Map())
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  const locations = computed(() => Array.from(friendLocations.value.values()))
  const hasLocations = computed(() => friendLocations.value.size > 0)

  /**
   * Decrypt a single encrypted location row and upsert it into the
   * reactive map. Returns the decrypted entry or `null` if it couldn't
   * be applied (missing keys, missing friend record, decrypt failure).
   *
   * Same code path is used by the initial fetch loop and the realtime
   * push handler — both produce identical state.
   */
  function applyEncryptedLocation(
    encLoc: EncryptedLocationPayload,
  ): FriendLocation | null {
    if (!isSetupComplete.value || !encryptionPrivateKey.value) return null
    if (!encLoc.senderHandle) return null

    const senderKey = encLoc.senderHandle.toLowerCase()
    const friend = friends.value.find(
      (f) => f.friendHandle.toLowerCase() === senderKey,
    )
    if (!friend) {
      console.warn(`No friend record for sender handle: ${encLoc.senderHandle}`)
      return null
    }
    if (!friend.friendEncryptionKey || !friend.friendSigningKey) {
      console.warn(
        `Friend ${friend.friendHandle} missing keys, skipping decrypt`,
      )
      return null
    }
    if (!myHandle.value) {
      console.warn('Own handle not available, skipping decrypt')
      return null
    }

    try {
      // v2 wire shape: `encryptedLocation` is the full ECIES blob,
      // `nonce` carries the RFC 3339 sentAt that the AAD binds.
      const friendSigningKey = importPublicKey(friend.friendSigningKey)
      const binding: FriendShareBinding = {
        senderId: friend.friendHandle,
        recipientId: myHandle.value,
        relationshipId: buildRelationshipId(
          friend.friendHandle,
          myHandle.value,
        ),
        timestamp: encLoc.nonce,
      }
      const locationData = decryptLocationFromFriendV2({
        blob: encLoc.encryptedLocation,
        myEncryptionPrivateKey: encryptionPrivateKey.value,
        senderSigningPublicKey: friendSigningKey,
        binding,
      })

      const friendLocation: FriendLocation = {
        friendHandle: friend.friendHandle,
        friendAlias: friend.friendHandle.split('@')[0],
        friendName: friend.friendName || undefined,
        friendPicture: friend.friendPicture || undefined,
        location: locationData,
        updatedAt: new Date(encLoc.updatedAt),
        lngLat: { lat: locationData.lat, lng: locationData.lng },
      }

      friendLocations.value.set(senderKey, friendLocation)
      return friendLocation
    } catch (decryptError) {
      console.warn(
        `Failed to decrypt location for ${friend.friendHandle}:`,
        decryptError,
      )
      return null
    }
  }

  /**
   * Drop a friend's marker from local state. Used by the
   * `location:cleared` realtime event when a sender disables sharing
   * or unfriends — receivers shouldn't keep showing the last-known
   * position.
   */
  function removeLocation(senderHandle: string): void {
    friendLocations.value.delete(senderHandle.toLowerCase())
  }

  /**
   * Fetch and decrypt all friend locations from the server. Used for
   * initial hydration and reconnect catch-up. Sweeps any local entry
   * not in the response — covers unfriending, sharing-disable, etc.
   * that we missed while offline.
   */
  async function fetchLocations(): Promise<FriendLocation[]> {
    if (!isSetupComplete.value || !encryptionPrivateKey.value) {
      console.warn('Identity not set up, cannot fetch friend locations')
      return []
    }

    isLoading.value = true
    error.value = null

    try {
      const encryptedLocations = await locationService.getFriendLocations()

      const seen = new Set<string>()
      const decrypted: FriendLocation[] = []
      for (const encLoc of encryptedLocations ?? []) {
        if (encLoc.senderHandle) seen.add(encLoc.senderHandle.toLowerCase())
        const applied = applyEncryptedLocation(encLoc)
        if (applied) decrypted.push(applied)
      }

      // Evict any entry that the server didn't return. Authoritative
      // sweep — covers unfriend, disable, and any other state drift.
      // Doesn't depend on the friends store being loaded (the previous
      // implementation wiped everything when `friends.value` was empty).
      for (const key of Array.from(friendLocations.value.keys())) {
        if (!seen.has(key)) friendLocations.value.delete(key)
      }

      return decrypted
    } catch (err) {
      console.error('Failed to fetch friend locations:', err)
      error.value = err instanceof Error ? err.message : 'Failed to fetch'
      return []
    } finally {
      isLoading.value = false
    }
  }

  function clearLocations() {
    friendLocations.value.clear()
  }

  function getLocationForFriend(
    friendHandle: string,
  ): FriendLocation | undefined {
    return friendLocations.value.get(friendHandle.toLowerCase())
  }

  function cleanup() {
    clearLocations()
  }

  return {
    // State
    friendLocations,
    locations,
    hasLocations,
    isLoading,
    error,

    // Actions
    fetchLocations,
    applyEncryptedLocation,
    removeLocation,
    clearLocations,
    getLocationForFriend,
    cleanup,
  }
}

export const useFriendLocations = createSharedComposable(
  friendLocationsComposable,
)
