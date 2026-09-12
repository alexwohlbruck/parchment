/**
 * DB-backed test for removing an integration whose config no longer decrypts.
 *
 * The unit tests are pure, so they can't show the trap that broke OSM
 * reconnects: a row encrypted under a retired key is filtered out of
 * `getConfiguredIntegrations`, while the unique index still sees it.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { users } from '../schema/users.schema'
import { integrations } from '../schema/integrations.schema'
import { generateId } from '../util'
import {
  deleteUserIntegrations,
  getConfiguredIntegrations,
} from './integration.service'
import { IntegrationId } from '../types/integration.enums'

const RUN_SUFFIX = Math.random().toString(36).slice(2, 8)
let userId = ''

beforeAll(async () => {
  userId = generateId()
  await db.insert(users).values({
    id: userId,
    email: `integrations-${RUN_SUFFIX}@parchment.test`,
    alias: `integrations_${RUN_SUFFIX}`,
    signingKey: 'sig',
    encryptionKey: 'enc',
  })
})

afterAll(async () => {
  if (userId) await db.delete(users).where(eq(users.id, userId))
})

/** A row whose ciphertext was written under a key this server doesn't hold. */
async function insertUndecryptableRow() {
  const id = generateId()
  await db.insert(integrations).values({
    id,
    userId,
    integrationId: IntegrationId.OPENSTREETMAP_ACCOUNT,
    scheme: 'server-key',
    capabilities: JSON.stringify([]),
    configCiphertext: Buffer.from('not-a-real-ciphertext').toString('base64'),
    configNonce: Buffer.alloc(12).toString('base64'),
    configKeyVersion: 1,
  })
  return id
}

describe('deleteUserIntegrations', () => {
  test('removes a row the readable listing cannot see', async () => {
    const id = await insertUndecryptableRow()

    const listed = await getConfiguredIntegrations(userId)
    expect(listed.find((i) => i.id === id)).toBeUndefined()

    const removed = await deleteUserIntegrations(
      userId,
      IntegrationId.OPENSTREETMAP_ACCOUNT,
    )
    expect(removed).toBe(1)

    const rows = await db
      .select()
      .from(integrations)
      .where(eq(integrations.userId, userId))
    expect(rows).toHaveLength(0)
  })

  test('reports nothing removed when the user has no such integration', async () => {
    const removed = await deleteUserIntegrations(
      userId,
      IntegrationId.OPENSTREETMAP_ACCOUNT,
    )
    expect(removed).toBe(0)
  })
})
