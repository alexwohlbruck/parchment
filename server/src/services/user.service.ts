/**
 * User Service
 *
 * Handles user account management including:
 * - User lookup
 * - Alias management
 * - Federation identity (keys)
 */

import { SQL, eq, sql } from 'drizzle-orm'
import { db } from '../db'
import { users } from '../schema/users.schema'
import { AnyPgColumn } from 'drizzle-orm/pg-core'
import { buildHandle } from './federation.service'

function lower(email: AnyPgColumn): SQL {
  return sql`lower(${email})`
}

// ============================================================================
// User Lookup
// ============================================================================

export async function fetchUser(userId: string) {
  return (await db.select().from(users).where(eq(users.id, userId)))[0]
}

export async function fetchUserByEmail(email: string) {
  return (
    await db
      .select()
      .from(users)
      .where(eq(lower(users.email), email.toLowerCase()))
  )[0]
}

// ============================================================================
// Federation Identity
// ============================================================================

/**
 * Get a user's full handle
 */
export async function getUserHandle(userId: string): Promise<string | null> {
  const user = await db
    .select({ alias: users.alias })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!user[0]?.alias) return null
  return buildHandle(user[0].alias)
}

/**
 * Update a user's alias (username)
 */
export async function updateUserAlias(
  userId: string,
  alias: string,
): Promise<{ success: boolean; error?: string }> {
  // Check if alias is already taken
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.alias, alias))
    .limit(1)

  if (existing[0] && existing[0].id !== userId) {
    return { success: false, error: 'Alias is already taken' }
  }

  await db
    .update(users)
    .set({ alias, updatedAt: new Date() })
    .where(eq(users.id, userId))

  return { success: true }
}

/**
 * Register or update a user's public keys
 */
export async function updateUserKeys(
  userId: string,
  signingKey: string,
  encryptionKey: string,
): Promise<void> {
  await db
    .update(users)
    .set({
      signingKey,
      encryptionKey,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
}

/**
 * Update the user's display profile fields. Names are cleartext — see
 * SECURITY.md for the scope of what IS encrypted. Passing `null` clears
 * the stored value.
 */
export async function updateUserDisplayProfile(
  userId: string,
  fields: {
    firstName?: string | null
    lastName?: string | null
  },
): Promise<void> {
  const update: Record<string, unknown> = { updatedAt: new Date() }
  if ('firstName' in fields) update.firstName = fields.firstName
  if ('lastName' in fields) update.lastName = fields.lastName
  await db.update(users).set(update).where(eq(users.id, userId))
}

/**
 * Get a user's public identity info
 */
export async function getUserIdentity(userId: string): Promise<{
  handle: string | null
  signingKey: string | null
  encryptionKey: string | null
} | null> {
  const user = await db
    .select({
      alias: users.alias,
      signingKey: users.signingKey,
      encryptionKey: users.encryptionKey,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!user[0]) return null

  return {
    handle: user[0].alias ? buildHandle(user[0].alias) : null,
    signingKey: user[0].signingKey,
    encryptionKey: user[0].encryptionKey,
  }
}

/**
 * Get local user ID from alias
 */
export async function getLocalUserIdByAlias(
  alias: string,
): Promise<string | null> {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.alias, alias))
    .limit(1)

  return user?.id || null
}
