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
 * Revoke a share (mark status='revoked'). For user-e2ee collections, the
 * caller is responsible for following up with a collection rotate-key so
 * the revoked recipient actually loses decrypt access; this endpoint only
 * flips the server flag.
 */
export async function revokeShare(shareId: string): Promise<void> {
  await api.post(`/sharing/${shareId}/revoke`)
}

/** Hard-delete a share row. Used when the sender decides a share was
 *  created in error and wants the row gone rather than a revoked trail. */
export async function deleteShare(shareId: string): Promise<void> {
  await api.delete(`/sharing/${shareId}`)
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
