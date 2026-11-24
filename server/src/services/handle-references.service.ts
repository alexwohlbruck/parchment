/**
 * Rows on this server that point at a user by handle rather than by id:
 * other users' friendships, invitations, location sharing and shares.
 * They must follow the user through an alias change and vanish with the
 * account, or a later holder of the alias inherits them.
 */

import { eq } from 'drizzle-orm'
import { db } from '../db'
import { friendships } from '../schema/friendships.schema'
import { friendInvitations } from '../schema/friend-invitations.schema'
import {
  encryptedLocations,
  locationSharingConfig,
} from '../schema/location.schema'
import { incomingShares, shares } from '../schema/shares.schema'
import { pendingRevocations } from '../schema/pending-revocations.schema'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export async function repointHandle(
  tx: Tx,
  oldHandle: string,
  newHandle: string,
): Promise<void> {
  await tx
    .update(friendships)
    .set({ friendHandle: newHandle })
    .where(eq(friendships.friendHandle, oldHandle))
  await tx
    .update(friendInvitations)
    .set({ fromHandle: newHandle })
    .where(eq(friendInvitations.fromHandle, oldHandle))
  await tx
    .update(friendInvitations)
    .set({ toHandle: newHandle })
    .where(eq(friendInvitations.toHandle, oldHandle))
  await tx
    .update(locationSharingConfig)
    .set({ friendHandle: newHandle })
    .where(eq(locationSharingConfig.friendHandle, oldHandle))
  await tx
    .update(encryptedLocations)
    .set({ forFriendHandle: newHandle })
    .where(eq(encryptedLocations.forFriendHandle, oldHandle))
  await tx
    .update(shares)
    .set({ recipientHandle: newHandle })
    .where(eq(shares.recipientHandle, oldHandle))
  await tx
    .update(incomingShares)
    .set({ senderHandle: newHandle })
    .where(eq(incomingShares.senderHandle, oldHandle))
  await tx
    .update(pendingRevocations)
    .set({ peerHandle: newHandle })
    .where(eq(pendingRevocations.peerHandle, oldHandle))
}

export async function purgeHandle(tx: Tx, handle: string): Promise<void> {
  await tx.delete(friendships).where(eq(friendships.friendHandle, handle))
  await tx
    .delete(friendInvitations)
    .where(eq(friendInvitations.fromHandle, handle))
  await tx.delete(friendInvitations).where(eq(friendInvitations.toHandle, handle))
  await tx
    .delete(locationSharingConfig)
    .where(eq(locationSharingConfig.friendHandle, handle))
  await tx
    .delete(encryptedLocations)
    .where(eq(encryptedLocations.forFriendHandle, handle))
  await tx.delete(shares).where(eq(shares.recipientHandle, handle))
  await tx.delete(incomingShares).where(eq(incomingShares.senderHandle, handle))
  await tx
    .delete(pendingRevocations)
    .where(eq(pendingRevocations.peerHandle, handle))
}
