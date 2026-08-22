import { db } from '../../db'
import {
  canvases,
  type Canvas,
  type CanvasBody,
  type NewCanvas,
} from '../../schema/canvases.schema'
import type { CollectionScheme } from '../../schema/library.schema'
import { and, eq, desc } from 'drizzle-orm'
import { generateId } from '../../util'

/**
 * Canvases service — persistence for user-built maps.
 *
 * Storage mirrors routes (see canvases.schema.ts header): metadata is always
 * E2EE; the body is cleartext for `server-key` and an encrypted blob for
 * `user-e2ee`. Creation is two-step, like collections and routes — the row is
 * minted first so the client knows the id to derive its per-canvas keys from,
 * then the encrypted metadata and body are PUT.
 */

export interface CreateCanvasParams {
  userId: string
  scheme?: CollectionScheme
  isPublic?: boolean
}

export interface UpdateCanvasParams {
  isPublic?: boolean
  metadataEncrypted?: string
  metadataKeyVersion?: number
  /** server-key content (cleartext). */
  body?: CanvasBody | null
  /** user-e2ee content (encrypted blob). */
  bodyEncrypted?: string | null
}

export async function getCanvases(userId: string): Promise<Canvas[]> {
  return await db
    .select()
    .from(canvases)
    .where(eq(canvases.userId, userId))
    .orderBy(desc(canvases.updatedAt))
}

export async function getCanvasById(
  id: string,
  userId: string,
): Promise<Canvas | undefined> {
  const [row] = await db
    .select()
    .from(canvases)
    .where(and(eq(canvases.id, id), eq(canvases.userId, userId)))
    .limit(1)
  return row
}

export async function createCanvas(
  params: CreateCanvasParams,
): Promise<Canvas> {
  const newCanvas: NewCanvas = {
    id: generateId(),
    userId: params.userId,
    scheme: params.scheme ?? 'server-key',
    isPublic: params.isPublic ?? false,
  }
  const [inserted] = await db.insert(canvases).values(newCanvas).returning()
  return inserted
}

export async function updateCanvas(
  id: string,
  userId: string,
  updates: UpdateCanvasParams,
): Promise<Canvas | undefined> {
  // Spread only the keys the caller actually sent, so a partial update can't
  // null out a body it never mentioned.
  const set: Record<string, unknown> = { updatedAt: new Date() }
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) set[key] = value
  }

  const [updated] = await db
    .update(canvases)
    .set(set)
    .where(and(eq(canvases.id, id), eq(canvases.userId, userId)))
    .returning()
  return updated
}

export async function deleteCanvas(
  id: string,
  userId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(canvases)
    .where(and(eq(canvases.id, id), eq(canvases.userId, userId)))
    .returning({ id: canvases.id })
  return deleted.length > 0
}
