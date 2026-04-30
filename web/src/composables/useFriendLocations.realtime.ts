/**
 * Realtime handlers for friend locations.
 *
 *   - `location:updated`: a friend posted a fresh ciphertext for us.
 *     Decrypt and upsert into the shared `useFriendLocations` state.
 *   - `location:cleared`: a friend disabled sharing or unfriended.
 *     Drop their marker so the UI evicts immediately instead of waiting
 *     for the next refetch.
 *   - `realtime:reconnected`: catch up on anything missed while offline.
 *     `fetchLocations()` also sweeps stale entries.
 *
 * Payloads are validated with type guards before use — a malformed
 * server emit becomes a silent no-op rather than a crash inside crypto
 * code. The bootstrap module imports this file once on app start;
 * nothing else should import it.
 */

import {
  isEncryptedLocationPayload,
  isLocationClearedPayload,
  useFriendLocations,
} from '@/composables/useFriendLocations'
import { registerRealtimeHandlers } from '@/lib/realtime-events'

function applyUpdate(payload: unknown) {
  if (!isEncryptedLocationPayload(payload)) {
    console.warn('[realtime] Ignoring malformed location:updated payload')
    return
  }
  useFriendLocations().applyEncryptedLocation(payload)
}

function applyCleared(payload: unknown) {
  if (!isLocationClearedPayload(payload)) {
    console.warn('[realtime] Ignoring malformed location:cleared payload')
    return
  }
  useFriendLocations().removeLocation(payload.senderHandle)
}

function refetch() {
  void useFriendLocations().fetchLocations()
}

registerRealtimeHandlers('friend-locations', {
  'location:updated': applyUpdate,
  'location:cleared': applyCleared,
  // Catch up on locations that landed (or were cleared) while the
  // socket was down.
  'realtime:reconnected': refetch,
})
