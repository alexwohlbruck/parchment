import { db } from '../../db'
import {
  encryptedPoints,
  collections,
  EncryptedPoint,
} from '../../schema/library.schema'
import { and, eq } from 'drizzle-orm'
import { generateId } from '../../util'
import { emit } from '../realtime/emit'

export interface NewEncryptedPointParams {
  collectionId: string
  userId: string
  encryptedData: string
  nonce: string
}

/**
 * Get all encrypted points in a collection
 */
export async function getEncryptedPointsInCollection(
  collectionId: string,
  userId: string,
): Promise<EncryptedPoint[]> {
  // Verify user owns the collection
  const [collection] = await db
    .select()
    .from(collections)
    .where(
      and(eq(collections.id, collectionId), eq(collections.userId, userId)),
    )
    .limit(1)

  if (!collection || collection.scheme !== 'user-e2ee') {
    return []
  }

  return await db
    .select()
    .from(encryptedPoints)
    .where(
      and(
        eq(encryptedPoints.collectionId, collectionId),
        eq(encryptedPoints.userId, userId),
      ),
    )
}

/**
 * Get a single encrypted point by ID
 */
export async function getEncryptedPointById(
  id: string,
  userId: string,
): Promise<EncryptedPoint | null> {
  const [point] = await db
    .select()
    .from(encryptedPoints)
    .where(
      and(eq(encryptedPoints.id, id), eq(encryptedPoints.userId, userId)),
    )
    .limit(1)

  return point || null
}

/**
 * Create a new encrypted point
 */
export async function createEncryptedPoint(
  params: NewEncryptedPointParams,
): Promise<EncryptedPoint> {
  // Verify collection exists and is sensitive
  const [collection] = await db
    .select()
    .from(collections)
    .where(
      and(
        eq(collections.id, params.collectionId),
        eq(collections.userId, params.userId),
      ),
    )
    .limit(1)

  if (!collection) {
    throw new Error('Collection not found')
  }

  if (collection.scheme !== 'user-e2ee') {
    throw new Error(
      'Collection scheme is not user-e2ee; encrypted points only belong in e2ee collections',
    )
  }

  const [point] = await db
    .insert(encryptedPoints)
    .values({
      id: generateId(),
      collectionId: params.collectionId,
      userId: params.userId,
      encryptedData: params.encryptedData,
      nonce: params.nonce,
    })
    .returning()

  await emit.collection('encrypted-point:created', point, params.collectionId)

  return point
}

/**
 * Update an encrypted point
 */
export async function updateEncryptedPoint(
  id: string,
  userId: string,
  encryptedData: string,
  nonce: string,
): Promise<EncryptedPoint | null> {
  const [updated] = await db
    .update(encryptedPoints)
    .set({
      encryptedData,
      nonce,
      updatedAt: new Date(),
    })
    .where(
      and(eq(encryptedPoints.id, id), eq(encryptedPoints.userId, userId)),
    )
    .returning()

  if (updated) {
    await emit.collection(
      'encrypted-point:updated',
      updated,
      updated.collectionId,
    )
  }

  return updated || null
}

/**
 * Delete an encrypted point
 */
export async function deleteEncryptedPoint(
  id: string,
  userId: string,
): Promise<boolean> {
  const result = await db
    .delete(encryptedPoints)
    .where(
      and(eq(encryptedPoints.id, id), eq(encryptedPoints.userId, userId)),
    )
    .returning()

  const deleted = result[0]
  if (deleted) {
    await emit.collection(
      'encrypted-point:deleted',
      { id: deleted.id, collectionId: deleted.collectionId },
      deleted.collectionId,
    )
  }

  return result.length > 0
}

/**
 * Delete all encrypted points in a collection
 */
export async function deleteAllEncryptedPointsInCollection(
  collectionId: string,
  userId: string,
): Promise<number> {
  const result = await db
    .delete(encryptedPoints)
    .where(
      and(
        eq(encryptedPoints.collectionId, collectionId),
        eq(encryptedPoints.userId, userId),
      ),
    )
    .returning()

  return result.length
}

/**
 * Toggle collection sensitive mode.
 *
 * DEPRECATED: legacy endpoint that only flips the flag; does NOT re-encrypt
 * existing points. The proper scheme-change flow lives in the collections
 * service and runs a transactional re-encrypt. This stays for backward
 * compatibility with clients that haven't been updated yet, but new
 * callers should use `changeCollectionScheme` instead.
 *
 * Both `is_sensitive` (compat mirror) and `scheme` are updated together so
 * reads remain consistent regardless of which field a caller inspects.
 */
export async function setCollectionSensitive(
  collectionId: string,
  userId: string,
  isSensitive: boolean,
): Promise<boolean> {
  const [updated] = await db
    .update(collections)
    .set({
      isSensitive,
      scheme: isSensitive ? 'user-e2ee' : 'server-key',
      updatedAt: new Date(),
    })
    .where(
      and(eq(collections.id, collectionId), eq(collections.userId, userId)),
    )
    .returning()

  return !!updated
}


