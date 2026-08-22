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
 * Storage follows the scheme (see canvases.schema.ts header): a `server-key`
 * canvas keeps its metadata and layer stack in cleartext columns; a
 * `user-e2ee` one keeps both in envelopes the server can't open.
 *
 * Creation stays two-step, like collections and routes — the row is minted
 * first so the client knows the id its per-canvas keys derive from, then the
 * metadata and body are PUT. A server-key canvas doesn't strictly need the
 * round trip, but keeping one path means the scheme can change later without
 * the client learning a second way to create things.
 */

export interface CreateCanvasParams {
  userId: string
  scheme?: CollectionScheme
  isPublic?: boolean
}

export interface UpdateCanvasParams {
  isPublic?: boolean
  /** server-key content (cleartext). */
  name?: string | null
  description?: string | null
  icon?: string | null
  iconColor?: string | null
  body?: CanvasBody | null
  /** user-e2ee content (encrypted blobs). */
  metadataEncrypted?: string | null
  metadataKeyVersion?: number
  bodyEncrypted?: string | null
}

/** Raised when a scheme switch targets the scheme the canvas already has. */
export class SchemeAlreadySetError extends Error {
  constructor(scheme: CollectionScheme) {
    super(`Canvas is already using the ${scheme} scheme`)
  }
}

export interface ChangeCanvasSchemeParams {
  canvasId: string
  userId: string
  targetScheme: CollectionScheme
  /** Populated for a switch to `server-key`. */
  name?: string | null
  description?: string | null
  icon?: string | null
  iconColor?: string | null
  body?: CanvasBody | null
  /** Populated for a switch to `user-e2ee`. */
  metadataEncrypted?: string | null
  metadataKeyVersion?: number
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

/**
 * Move a canvas between schemes, clearing whichever side it left.
 *
 * The client does the cryptography — it is the only party that can — and
 * hands over a complete record in the target scheme. This just swaps it in,
 * atomically, so a canvas is never briefly readable in both forms or neither.
 *
 * A switch to `user-e2ee` also drops any public link: the server would no
 * longer be able to render what that link promises.
 */
export async function changeCanvasScheme(
  params: ChangeCanvasSchemeParams,
): Promise<Canvas | undefined> {
  const existing = await getCanvasById(params.canvasId, params.userId)
  if (!existing) return undefined
  if (existing.scheme === params.targetScheme) {
    throw new SchemeAlreadySetError(params.targetScheme)
  }

  const toE2ee = params.targetScheme === 'user-e2ee'

  const [updated] = await db
    .update(canvases)
    .set({
      scheme: params.targetScheme,
      updatedAt: new Date(),
      // Cleartext side.
      name: toE2ee ? null : (params.name ?? null),
      description: toE2ee ? null : (params.description ?? null),
      icon: toE2ee ? null : (params.icon ?? null),
      iconColor: toE2ee ? null : (params.iconColor ?? null),
      body: toE2ee ? null : (params.body ?? null),
      // Encrypted side.
      metadataEncrypted: toE2ee ? (params.metadataEncrypted ?? null) : null,
      metadataKeyVersion: params.metadataKeyVersion ?? existing.metadataKeyVersion,
      bodyEncrypted: toE2ee ? (params.bodyEncrypted ?? null) : null,
      // A link the server can no longer honour is revoked with the switch.
      ...(toE2ee
        ? { isPublic: false, publicToken: null, publicRole: null }
        : {}),
    })
    .where(and(eq(canvases.id, params.canvasId), eq(canvases.userId, params.userId)))
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
