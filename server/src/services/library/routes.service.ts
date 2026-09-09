import { db } from '../../db'
import { routes, Route, NewRoute, RouteBody } from '../../schema/routes.schema'
import { and, eq, desc } from 'drizzle-orm'
import { generateId } from '../../util'
import { randomBytes } from 'node:crypto'

/**
 * Routes service — persistence for user-built custom routes.
 *
 * Storage mirrors collections (see routes.schema.ts header): metadata is
 * always E2EE; the body is cleartext for `server-key` and an encrypted blob
 * for `user-e2ee`. Routes are not friend-shared in v1 — the only sharing
 * path is a public link, which (as with collections) requires server-key.
 */

export interface CreateRouteParams {
  userId: string
  mode?: 'walking' | 'cycling' | 'driving'
  scheme?: 'server-key' | 'user-e2ee'
  isPublic?: boolean
}

export interface UpdateRouteParams {
  mode?: 'walking' | 'cycling' | 'driving'
  isPublic?: boolean
  metadataEncrypted?: string
  metadataKeyVersion?: number
  // server-key content (cleartext)
  body?: RouteBody | null
  distance?: number | null
  duration?: number | null
  elevationGain?: number | null
  elevationLoss?: number | null
  // user-e2ee content (encrypted blob)
  bodyEncrypted?: string | null
  bodyNonce?: string | null
}

export async function getRoutes(userId: string): Promise<Route[]> {
  return await db
    .select()
    .from(routes)
    .where(eq(routes.userId, userId))
    .orderBy(desc(routes.updatedAt))
}

export async function getRouteById(
  id: string,
  userId: string,
): Promise<Route | undefined> {
  const [row] = await db
    .select()
    .from(routes)
    .where(and(eq(routes.id, id), eq(routes.userId, userId)))
    .limit(1)
  return row
}

export async function createRoute(params: CreateRouteParams): Promise<Route> {
  const newRoute: NewRoute = {
    id: generateId(),
    userId: params.userId,
    mode: params.mode ?? 'walking',
    scheme: params.scheme ?? 'server-key',
    isPublic: params.isPublic ?? false,
  }
  const [inserted] = await db.insert(routes).values(newRoute).returning()
  return inserted
}

export async function updateRoute(
  id: string,
  userId: string,
  updates: UpdateRouteParams,
): Promise<Route | undefined> {
  // Drizzle's jsonb column expects the object as-is; spread only defined keys
  // so a partial update doesn't null out fields the caller omitted.
  const set: Record<string, unknown> = { updatedAt: new Date() }
  for (const [k, v] of Object.entries(updates)) {
    if (v !== undefined) set[k] = v
  }

  const [updated] = await db
    .update(routes)
    .set(set)
    .where(and(eq(routes.id, id), eq(routes.userId, userId)))
    .returning()
  return updated
}

export async function deleteRoute(
  id: string,
  userId: string,
): Promise<boolean> {
  const result = await db
    .delete(routes)
    .where(and(eq(routes.id, id), eq(routes.userId, userId)))
    .returning()
  return result.length > 0
}

// ===== Public Link Sharing =====

export class PublicLinkNotAllowedOnE2eeError extends Error {
  constructor() {
    super('Public links are only allowed on server-key routes')
    this.name = 'PublicLinkNotAllowedOnE2eeError'
  }
}

/**
 * Mint a public-link token. Owner-only, server-key only. Idempotent — an
 * existing token is returned unchanged.
 */
export async function createPublicLink(
  id: string,
  userId: string,
): Promise<{ publicToken: string; publicRole: 'viewer' } | null> {
  const route = await getRouteById(id, userId)
  if (!route) return null
  if (route.scheme !== 'server-key') {
    throw new PublicLinkNotAllowedOnE2eeError()
  }
  if (route.publicToken) {
    return { publicToken: route.publicToken, publicRole: 'viewer' }
  }

  const token = randomBytes(32).toString('base64url')
  const [updated] = await db
    .update(routes)
    .set({
      publicToken: token,
      publicRole: 'viewer',
      isPublic: true,
      updatedAt: new Date(),
    })
    .where(and(eq(routes.id, id), eq(routes.userId, userId)))
    .returning()
  if (!updated) return null
  return { publicToken: token, publicRole: 'viewer' }
}

export async function revokePublicLink(
  id: string,
  userId: string,
): Promise<boolean> {
  const [updated] = await db
    .update(routes)
    .set({
      publicToken: null,
      publicRole: null,
      isPublic: false,
      updatedAt: new Date(),
    })
    .where(and(eq(routes.id, id), eq(routes.userId, userId)))
    .returning()
  return !!updated
}

/**
 * Resolve a public-link token to its route. Server-key only (the body must
 * be server-readable to render the shared view). Returns null → 404.
 */
export async function getPublicRouteByToken(
  token: string,
): Promise<Route | null> {
  const [route] = await db
    .select()
    .from(routes)
    .where(eq(routes.publicToken, token))
    .limit(1)
  if (!route) return null
  if (route.scheme !== 'server-key') return null
  return route
}
