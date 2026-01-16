import { db } from '../../db'
import {
  encryptedPoints,
  collections,
  EncryptedPoint,
} from '../../schema/library.schema'
import { and, eq } from 'drizzle-orm'
import { generateId } from '../../util'

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

  if (!collection || !collection.isSensitive) {
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

  if (!collection.isSensitive) {
    throw new Error('Collection is not marked as sensitive')
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
 * Toggle collection sensitive mode
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
      updatedAt: new Date(),
    })
    .where(
      and(eq(collections.id, collectionId), eq(collections.userId, userId)),
    )
    .returning()

  return !!updated
}


