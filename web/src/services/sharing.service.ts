/**
 * Client-side sharing service.
 *
 * Thin wrapper over the `/sharing` + `/library/collections/:id/public-link`
 * HTTP endpoints. Consumers: the ShareDialog component tree, the
 * collection context menu, and anywhere else that needs to create, list,
 * or revoke shares.
 *
 * This module deliberately keeps no state of its own — the authoritative
 * source for "who has access" is the server. Components re-fetch after
 * mutations so the UI always reflects real server state.
 */

import { api } from '@/lib/api'
import type { ShareRole } from '@/types/library.types'

export interface OutgoingShare {
  id: string
  userId: string
  recipientHandle: string
  recipientUserId: string | null
  resourceType: 'collection' | 'route' | 'map' | 'layer'
  resourceId: string
  role: ShareRole
  status: 'pending' | 'accepted' | 'rejected' | 'revoked'
  createdAt: string
  acceptedAt: string | null
  expiresAt: string | null
}

export interface IncomingShare {
  id: string
  userId: string
  senderHandle: string
  resourceType: string
  resourceId: string
  encryptedData: string
  nonce: string
  role: ShareRole
  status: 'pending' | 'accepted' | 'rejected'
  createdAt: string
  acceptedAt: string | null
}

export interface PublicLink {
  publicToken: string
  publicRole: 'viewer'
}

export interface CreateShareInput {
  recipientHandle: string
  resourceType: 'collection' | 'route' | 'map' | 'layer'
  resourceId: string
  role: ShareRole
  encryptedData: string
  nonce: string
  // Signed v2 envelope for cross-server delivery. Required when the
  // recipient is on a different server; unused for same-server shares.
  federationSignature?: string
  federationNonce?: string
  federationTimestamp?: string
}

/**
 * List outgoing shares for a given resource. Filters server-side by
 * the caller's userId so we never see someone else's share rows.
 */
export async function listSharesForResource(
  resourceType: OutgoingShare['resourceType'],
  resourceId: string,
): Promise<OutgoingShare[]> {
  const { data } = await api.get<{ shares: OutgoingShare[] }>(
    `/sharing/outgoing/${resourceType}/${resourceId}`,
  )
  return data.shares
}

/** Create a new share. Throws on 4xx — caller decides how to surface. */
export async function createShare(
  input: CreateShareInput,
): Promise<OutgoingShare> {
  const { data } = await api.post<OutgoingShare>('/sharing', input)
  return data
}

/**
 * Revoke a share. Server hard-deletes both the outgoing row and the
 * same-server recipient's mirrored incoming row. For user-e2ee
 * collections, the caller is still responsible for following up with
 * `rotateCollectionKey` so the revoked recipient actually loses decrypt
 * access — this endpoint only removes the ACL bookkeeping.
 */
export async function revokeShare(shareId: string): Promise<void> {
  await api.post(`/sharing/${shareId}/revoke`)
}

/** Hard-delete a share row. Same server-side semantics as revoke today,
 *  kept as a separate endpoint for API symmetry. */
export async function deleteShare(shareId: string): Promise<void> {
  await api.delete(`/sharing/${shareId}`)
}

/**
 * Change the role on an existing share. Avoids the revoke+recreate
 * pattern, which tripped over the unique index on `shares`.
 */
export async function updateShareRole(
  shareId: string,
  role: ShareRole,
): Promise<OutgoingShare> {
  const { data } = await api.patch<OutgoingShare>(`/sharing/${shareId}`, {
    role,
  })
  return data
}

/** Mint a public-link token on a collection. Server rejects user-e2ee. */
export async function createPublicLink(
  collectionId: string,
): Promise<PublicLink> {
  const { data } = await api.post<PublicLink>(
    `/library/collections/${collectionId}/public-link`,
  )
  return data
}

/** Revoke the public-link token on a collection. Idempotent. */
export async function revokePublicLink(collectionId: string): Promise<void> {
  await api.delete(`/library/collections/${collectionId}/public-link`)
}

/**
 * Build the publicly-shareable URL for a collection token. The URL
 * always points at the owner's home server; callers should read
 * `useServerUrl()` for the correct base.
 */
export function buildPublicLinkUrl(serverUrl: string, token: string): string {
  const base = serverUrl.replace(/\/$/, '')
  return `${base}/public/collections/${token}`
}
