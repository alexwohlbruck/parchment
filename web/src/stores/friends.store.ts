import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import {
  getFriends,
  getInvitations,
  sendInvitation,
  acceptInvitation,
  rejectInvitation,
  cancelInvitation,
  removeFriend,
  resolveHandle,
  syncFriendKeys,
  type Friendship,
  type FriendInvitation,
  type RemoteUserInfo,
} from '@/services/friends.service'
import { useIdentityStore } from './identity.store'

export const useFriendsStore = defineStore('friends', () => {
  const identityStore = useIdentityStore()

  // State
  const friends = ref<Friendship[]>([])
  const incomingInvitations = ref<FriendInvitation[]>([])
  const outgoingInvitations = ref<FriendInvitation[]>([])
  const isLoading = ref(false)
  const resolvedUsers = ref<Map<string, RemoteUserInfo>>(new Map())

  // Computed
  const friendCount = computed(() => friends.value.length)
  const pendingIncomingCount = computed(() => incomingInvitations.value.length)
  const pendingOutgoingCount = computed(() => outgoingInvitations.value.length)
  const hasPendingInvitations = computed(
    () =>
      incomingInvitations.value.length > 0 ||
      outgoingInvitations.value.length > 0,
  )

  /**
   * Load all friends data
   */
  async function loadFriends() {
    isLoading.value = true
    try {
      friends.value = await getFriends()
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Sync friend public keys from their servers.
   * This MUST be called before attempting to decrypt friend locations.
   * Returns true if any keys were updated.
   */
  async function syncKeys(): Promise<boolean> {
    try {
      const result = await syncFriendKeys()
      const anyUpdated = result.results.some(r => r.updated)

      // If any keys were updated, reload friends to get fresh data
      if (anyUpdated) {
        friends.value = await getFriends()
      }

      return anyUpdated
    } catch (err) {
      console.warn('Failed to sync friend keys:', err)
      return false
    }
  }

  /**
   * Load all invitations
   */
  async function loadInvitations() {
    isLoading.value = true
    try {
      const [incoming, outgoing] = await Promise.all([
        getInvitations('incoming'),
        getInvitations('outgoing'),
      ])
      incomingInvitations.value = incoming
      outgoingInvitations.value = outgoing
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Load all friends and invitations
   */
  async function loadAll() {
    isLoading.value = true
    try {
      await Promise.all([loadFriends(), loadInvitations()])
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Send a friend invitation
   */
  async function invite(
    handle: string,
  ): Promise<{ success: boolean; error?: string }> {
    const myHandle = identityStore.handle
    if (!myHandle) {
      return { success: false, error: 'You must set up your identity first' }
    }

    const result = await sendInvitation(handle, myHandle)

    if (result.success && result.invitation) {
      outgoingInvitations.value.push(result.invitation)
    }

    return result
  }

  /**
   * Accept an invitation
   */
  async function accept(
    invitation: FriendInvitation,
  ): Promise<{ success: boolean; error?: string }> {
    const myHandle = identityStore.handle
    if (!myHandle) {
      return { success: false, error: 'You must set up your identity first' }
    }

    const result = await acceptInvitation(
      invitation.id,
      myHandle,
      invitation.fromHandle,
    )

    if (result.success) {
      // Remove from incoming
      incomingInvitations.value = incomingInvitations.value.filter(
        inv => inv.id !== invitation.id,
      )
      // Reload friends to get the new friend
      await loadFriends()
    }

    return result
  }

  /**
   * Reject an invitation
   */
  async function reject(
    invitation: FriendInvitation,
  ): Promise<{ success: boolean; error?: string }> {
    const myHandle = identityStore.handle

    const result = await rejectInvitation(
      invitation.id,
      myHandle || undefined,
      invitation.fromHandle,
    )

    if (result.success) {
      incomingInvitations.value = incomingInvitations.value.filter(
        inv => inv.id !== invitation.id,
      )
    }

    return result
  }

  /**
   * Cancel an outgoing invitation
   */
  async function cancel(
    invitation: FriendInvitation,
  ): Promise<{ success: boolean; error?: string }> {
    const result = await cancelInvitation(invitation.id)

    if (result.success) {
      outgoingInvitations.value = outgoingInvitations.value.filter(
        inv => inv.id !== invitation.id,
      )
    }

    return result
  }

  /**
   * Remove a friend
   */
  async function remove(
    friendship: Friendship,
  ): Promise<{ success: boolean; error?: string }> {
    const result = await removeFriend(friendship.friendHandle)

    if (result.success) {
      friends.value = friends.value.filter(f => f.id !== friendship.id)
    }

    return result
  }

  /**
   * Resolve a handle to get user info
   */
  async function resolve(handle: string): Promise<RemoteUserInfo | null> {
    // Check cache first
    if (resolvedUsers.value.has(handle)) {
      return resolvedUsers.value.get(handle)!
    }

    const userInfo = await resolveHandle(handle)

    if (userInfo) {
      resolvedUsers.value.set(handle, userInfo)
    }

    return userInfo
  }

  /**
   * Clear all data (for logout)
   */
  function clear() {
    friends.value = []
    incomingInvitations.value = []
    outgoingInvitations.value = []
    resolvedUsers.value.clear()
  }

  return {
    // State
    friends,
    incomingInvitations,
    outgoingInvitations,
    isLoading,

    // Computed
    friendCount,
    pendingIncomingCount,
    pendingOutgoingCount,
    hasPendingInvitations,

    // Actions
    loadFriends,
    loadInvitations,
    loadAll,
    syncKeys,
    invite,
    accept,
    reject,
    cancel,
    remove,
    resolve,
    clear,
  }
})
