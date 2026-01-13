/**
 * Friends Service
 * 
 * API client for friends-related operations
 */

import { api } from '@/lib/api'
import { signFederationMessage } from './identity.service'

export interface Friendship {
  id: string
  userId: string
  friendHandle: string
  friendSigningKey: string | null
  friendEncryptionKey: string | null
  friendName: string | null
  friendPicture: string | null
  status: 'accepted'
  establishedAt: string | null
  createdAt: string
}

export interface FriendInvitation {
  id: string
  fromHandle: string
  toHandle: string
  localUserId: string | null
  direction: 'incoming' | 'outgoing'
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled'
  originServer: string
  signature: string | null
  createdAt: string
  expiresAt: string | null
}

export interface RemoteUserInfo {
  handle: string
  signingKey: string
  encryptionKey: string
  inbox: string
  name?: string
  picture?: string
}

/**
 * Get list of friends
 */
export async function getFriends(): Promise<Friendship[]> {
  const response = await api.get<{ friends: Friendship[] }>('/friends')
  return response.data.friends
}

/**
 * Get pending invitations
 */
export async function getInvitations(
  direction?: 'incoming' | 'outgoing',
): Promise<FriendInvitation[]> {
  const params = direction ? { direction } : {}
  const response = await api.get<{ invitations: FriendInvitation[] }>(
    '/friends/invitations',
    { params },
  )
  return response.data.invitations
}

/**
 * Send a friend invitation
 */
export async function sendInvitation(
  handle: string,
  myHandle: string,
): Promise<{ success: boolean; invitation?: FriendInvitation; error?: string }> {
  try {
    // Create signature for the invitation
    const timestamp = new Date().toISOString()
    const signature = await signFederationMessage('FRIEND_INVITE', {
      from: myHandle,
      to: handle,
      timestamp,
    })

    const response = await api.post<{ invitation: FriendInvitation }>(
      '/friends/invite',
      { handle, signature },
    )

    return { success: true, invitation: response.data.invitation }
  } catch (error: any) {
    return {
      success: false,
      error: error.response?.data?.message || 'Failed to send invitation',
    }
  }
}

/**
 * Accept a friend invitation
 */
export async function acceptInvitation(
  invitationId: string,
  myHandle: string,
  theirHandle: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const timestamp = new Date().toISOString()
    const signature = await signFederationMessage('FRIEND_ACCEPT', {
      from: myHandle,
      to: theirHandle,
      timestamp,
    })

    await api.post(`/friends/invitations/${invitationId}/accept`, { signature })
    return { success: true }
  } catch (error: any) {
    return {
      success: false,
      error: error.response?.data?.message || 'Failed to accept invitation',
    }
  }
}

/**
 * Reject a friend invitation
 */
export async function rejectInvitation(
  invitationId: string,
  myHandle?: string,
  theirHandle?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    let signature: string | undefined
    
    if (myHandle && theirHandle) {
      const timestamp = new Date().toISOString()
      signature = await signFederationMessage('FRIEND_REJECT', {
        from: myHandle,
        to: theirHandle,
        timestamp,
      })
    }

    await api.post(`/friends/invitations/${invitationId}/reject`, { signature })
    return { success: true }
  } catch (error: any) {
    return {
      success: false,
      error: error.response?.data?.message || 'Failed to reject invitation',
    }
  }
}

/**
 * Cancel an outgoing invitation
 */
export async function cancelInvitation(
  invitationId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await api.delete(`/friends/invitations/${invitationId}`)
    return { success: true }
  } catch (error: any) {
    return {
      success: false,
      error: error.response?.data?.message || 'Failed to cancel invitation',
    }
  }
}

/**
 * Remove a friend
 */
export async function removeFriend(
  handle: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await api.delete(`/friends/${encodeURIComponent(handle)}`)
    return { success: true }
  } catch (error: any) {
    return {
      success: false,
      error: error.response?.data?.message || 'Failed to remove friend',
    }
  }
}

/**
 * Resolve a handle to user info
 */
export async function resolveHandle(
  handle: string,
): Promise<RemoteUserInfo | null> {
  try {
    const response = await api.get<RemoteUserInfo>(
      `/friends/resolve/${encodeURIComponent(handle)}`,
    )
    return response.data
  } catch {
    return null
  }
}

/**
 * Sync friend public keys from their servers
 * This fixes key drift issues when keys are regenerated
 */
export async function syncFriendKeys(): Promise<{
  results: Array<{ handle: string; updated: boolean; error?: string }>
}> {
  const response = await api.post<{
    results: Array<{ handle: string; updated: boolean; error?: string }>
  }>('/friends/sync-keys')
  return response.data
}

