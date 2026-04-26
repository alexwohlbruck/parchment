/**
 * Revocation fan-out for post-reset identity cleanup.
 *
 * When a user resets their E2EE identity, `resetUserIdentity` snapshots
 * every peer handle that had a now-orphaned relationship (friendship,
 * shares either direction, pending invitations) into
 * `pending_revocations`. Those peers still have cached state on their
 * own servers that points at us with our OLD keys — cryptographically
 * dead.
 *
 * This service drives the fan-out: once the user has re-registered a
 * new keypair under the SAME alias, the client signs a v2
 * RELATIONSHIP_REVOKE envelope per pending handle and posts them here.
 * We forward each as a federation message from the user's handle. The
 * peer's inbox resolves the sender live (→ new signingKey), verifies
 * the signature, and runs `handleIncomingRelationshipRevoke` which
 * wipes the orphaned rows on their side.
 *
 * The server never synthesizes these signatures. The user (with their
 * seed-derived Ed25519 key) is the only valid signer; delegating to
 * server identity would let a compromised server erase its users'
 * cross-server state unilaterally.
 */

import { and, eq } from 'drizzle-orm'
import { db } from '../db'
import { pendingRevocations } from '../schema/pending-revocations.schema'
import {
  sendFederationMessage,
  type FederationMessage,
  type FederationMessageType,
} from './federation.service'
import { getUserHandle } from './user.service'
import { logger } from '../lib/logger'

export interface PendingRevocationRow {
  id: string
  peerHandle: string
  createdAt: Date
}

export async function listPendingRevocations(
  userId: string,
): Promise<PendingRevocationRow[]> {
  const rows = await db
    .select({
      id: pendingRevocations.id,
      peerHandle: pendingRevocations.peerHandle,
      createdAt: pendingRevocations.createdAt,
    })
    .from(pendingRevocations)
    .where(eq(pendingRevocations.userId, userId))
  return rows
}

/**
 * One fan-out attempt. Caller supplies the client-signed envelope for
 * each peer handle; server wraps in transport auth and forwards.
 *
 * Only rows that actually belong to the caller AND match a handle in
 * `pending_revocations` are sent — the client is not allowed to
 * piggyback this endpoint to send a RELATIONSHIP_REVOKE to an arbitrary
 * peer that wasn't part of the original snapshot.
 *
 * Rows for peers whose delivery SUCCEEDED are deleted. Rows whose
 * delivery FAILED stay in place so a later retry can pick them up.
 * That way a transient outage doesn't silently leak orphans; the user
 * (or a background sweep) can re-run flush until the list is empty.
 */
export interface FlushRequestItem {
  peerHandle: string
  signature: string
  nonce: string
  timestamp: string
  messageVersion?: number
}

export interface FlushResultItem {
  peerHandle: string
  delivered: boolean
  error?: string
}

export async function flushPendingRevocations(
  userId: string,
  items: FlushRequestItem[],
): Promise<FlushResultItem[]> {
  const myHandle = await getUserHandle(userId)
  if (!myHandle) {
    return items.map((i) => ({
      peerHandle: i.peerHandle,
      delivered: false,
      error: 'No alias set — re-register identity before flushing',
    }))
  }

  const pending = await db
    .select({
      id: pendingRevocations.id,
      peerHandle: pendingRevocations.peerHandle,
    })
    .from(pendingRevocations)
    .where(eq(pendingRevocations.userId, userId))

  const pendingByHandle = new Map(pending.map((p) => [p.peerHandle, p.id]))
  const results: FlushResultItem[] = []

  for (const item of items) {
    const pendingId = pendingByHandle.get(item.peerHandle)
    if (!pendingId) {
      results.push({
        peerHandle: item.peerHandle,
        delivered: false,
        error: 'No pending revocation for this peer',
      })
      continue
    }

    const message: FederationMessage = {
      protocol_version: 2,
      message_type: 'RELATIONSHIP_REVOKE' as FederationMessageType,
      message_version: item.messageVersion ?? 1,
      nonce: item.nonce,
      timestamp: item.timestamp,
      from: myHandle,
      to: item.peerHandle,
      signature: item.signature,
      payload: {},
    }

    try {
      const delivered = await sendFederationMessage(item.peerHandle, message)
      if (delivered) {
        await db
          .delete(pendingRevocations)
          .where(
            and(
              eq(pendingRevocations.id, pendingId),
              eq(pendingRevocations.userId, userId),
            ),
          )
        results.push({ peerHandle: item.peerHandle, delivered: true })
      } else {
        results.push({
          peerHandle: item.peerHandle,
          delivered: false,
          error: 'Peer server refused the message',
        })
      }
    } catch (err) {
      logger.warn(
        { err, peerHandle: item.peerHandle, userId },
        'Failed to deliver pending revocation',
      )
      results.push({
        peerHandle: item.peerHandle,
        delivered: false,
        error: (err as Error).message || 'Delivery failed',
      })
    }
  }

  return results
}

/**
 * Drop a pending row without sending anything. Used when the client
 * can't or won't sign for a handle (e.g. a handle that no longer
 * resolves, which would fail signature verification anyway). The
 * cached state on the peer's side remains orphaned — caller accepts
 * that tradeoff.
 */
export async function discardPendingRevocation(
  userId: string,
  peerHandle: string,
): Promise<boolean> {
  const deleted = await db
    .delete(pendingRevocations)
    .where(
      and(
        eq(pendingRevocations.userId, userId),
        eq(pendingRevocations.peerHandle, peerHandle),
      ),
    )
    .returning({ id: pendingRevocations.id })
  return deleted.length > 0
}
