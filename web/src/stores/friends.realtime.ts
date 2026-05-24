/**
 * Realtime handlers for the friends store.
 *
 * V1 approach: refetch the relevant list on each friendship / invitation
 * event. The store doesn't currently expose upsert/delete-by-id methods
 * (see `friends.store.ts`), so going through `loadFriends` /
 * `loadInvitations` is the idempotent path.
 *
 * Refetch cost is bounded — the friends list is small — and the
 * simplicity is worth it. A follow-up can add delta methods if we see
 * this hurting responsiveness on large accounts.
 */

import { useFriendsStore } from './friends.store'
import { useAuthStore } from './auth.store'
import { registerRealtimeHandlers } from '@/lib/realtime-events'
import { PermissionId } from '@/types/auth.types'

/** Guard — skip the fetch when the user lacks SOCIAL_READ (free tier). */
function canReadSocial(): boolean {
  return useAuthStore().permissions.includes(PermissionId.SOCIAL_READ)
}

function refetchFriends() {
  if (!canReadSocial()) return
  void useFriendsStore().loadFriends()
}

function refetchInvitations() {
  if (!canReadSocial()) return
  void useFriendsStore().loadInvitations()
}

function refetchAll() {
  if (!canReadSocial()) return
  void useFriendsStore().loadAll()
}

registerRealtimeHandlers('friends', {
  'friendship:created': refetchAll,
  'friendship:removed': refetchFriends,
  'friend-invitation:created': refetchInvitations,
  'friend-invitation:rejected': refetchInvitations,
  'friend-invitation:cancelled': refetchInvitations,
  // Profile changes (alias / display name) affect friendship rows' cached
  // friend_name / friend_picture — refetch to keep labels current.
  'user:profile-updated': refetchFriends,
  // On reconnect, catch up on anything missed while offline.
  'realtime:reconnected': refetchAll,
})
