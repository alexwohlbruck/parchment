/**
 * Server-side personal-blob service.
 *
 * Opaque storage for client-encrypted blobs keyed by (userId, blobType).
 * The server never sees cleartext. Its only job is: accept PUT, store the
 * envelope; accept GET, return the envelope.
 */

import { and, eq } from 'drizzle-orm'
import { db } from '../db'
import { encryptedUserBlobs } from '../schema/personal-blobs.schema'

export interface PersonalBlobValue {
  encryptedBlob: string
  nonce: string
  kmVersion: number
  updatedAt: Date
}

export async function getPersonalBlob(
  userId: string,
  blobType: string,
): Promise<PersonalBlobValue | null> {
  const row = await db
    .select()
    .from(encryptedUserBlobs)
    .where(
      and(
        eq(encryptedUserBlobs.userId, userId),
        eq(encryptedUserBlobs.blobType, blobType),
      ),
    )
    .limit(1)
  if (!row[0]) return null
  return {
    encryptedBlob: row[0].encryptedBlob,
    nonce: row[0].nonce,
    kmVersion: row[0].kmVersion,
    updatedAt: row[0].updatedAt,
  }
}

/**
 * Replace the stored blob atomically. Each PUT fully overwrites — the
 * client is responsible for merging + capping entries before uploading.
 */
export async function putPersonalBlob(
  userId: string,
  blobType: string,
  value: { encryptedBlob: string; nonce: string; kmVersion: number },
): Promise<void> {
  await db
    .insert(encryptedUserBlobs)
    .values({
      userId,
      blobType,
      encryptedBlob: value.encryptedBlob,
      nonce: value.nonce,
      kmVersion: value.kmVersion,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [encryptedUserBlobs.userId, encryptedUserBlobs.blobType],
      set: {
        encryptedBlob: value.encryptedBlob,
        nonce: value.nonce,
        kmVersion: value.kmVersion,
        updatedAt: new Date(),
      },
    })
}

export async function deletePersonalBlob(
  userId: string,
  blobType: string,
): Promise<void> {
  await db
    .delete(encryptedUserBlobs)
    .where(
      and(
        eq(encryptedUserBlobs.userId, userId),
        eq(encryptedUserBlobs.blobType, blobType),
      ),
    )
}

/**
 * List every blob type the user has stored. Used by the client-side K_m
 * rotation orchestrator so it knows which blobs need to be decrypted under
 * the old seed and re-encrypted under the new one. Server returns types +
 * kmVersion only; never the ciphertext.
 */
export async function listPersonalBlobTypes(
  userId: string,
): Promise<Array<{ blobType: string; kmVersion: number }>> {
  const rows = await db
    .select({
      blobType: encryptedUserBlobs.blobType,
      kmVersion: encryptedUserBlobs.kmVersion,
    })
    .from(encryptedUserBlobs)
    .where(eq(encryptedUserBlobs.userId, userId))
  return rows
}
