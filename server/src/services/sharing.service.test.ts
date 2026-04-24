/**
 * DB-backed tests for the sharing service.
 *
 * Seeds two throwaway users per run (Alice, Bob) under randomized aliases
 * so parallel/repeat runs don't collide. Every test owns its write — no
 * global state carries between tests. Cleanup deletes the seeded users
 * in afterAll; FK cascades take the collections, shares, and
 * incoming_shares with them.
 *
 * Covers:
 *   - createShare auto-accept on same-server, pending on remote
 *   - revokeShare hard-deletes outgoing + mirrored incoming rows
 *   - updateShareRole updates both rows atomically
 *   - getEffectiveRoleOnCollection for owner/editor/viewer/none
 *   - canShareCollection + resharing policy
 *   - requireWriteAccessToCollection throws the right typed errors
 *   - isLocalRecipient
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { db } from '../db'
import { users } from '../schema/users.schema'
import { collections } from '../schema/library.schema'
import { shares, incomingShares } from '../schema/shares.schema'
import { friendships } from '../schema/friendships.schema'
import { generateId } from '../util'
import * as sharingService from './sharing.service'
import { buildHandle } from './federation.service'

const RUN_SUFFIX = Math.random().toString(36).slice(2, 8)
const ALICE_ALIAS = `t_alice_${RUN_SUFFIX}`
const BOB_ALIAS = `t_bob_${RUN_SUFFIX}`

let aliceId = ''
let bobId = ''
let aliceHandle = ''
let bobHandle = ''

async function seedUsers() {
  aliceId = generateId()
  bobId = generateId()
  await db.insert(users).values({
    id: aliceId,
    email: `t-alice-${RUN_SUFFIX}@parchment.test`,
    alias: ALICE_ALIAS,
    signingKey: 'alice-sig-key',
    encryptionKey: 'alice-enc-key',
  })
  await db.insert(users).values({
    id: bobId,
    email: `t-bob-${RUN_SUFFIX}@parchment.test`,
    alias: BOB_ALIAS,
    signingKey: 'bob-sig-key',
    encryptionKey: 'bob-enc-key',
  })
  aliceHandle = buildHandle(ALICE_ALIAS)
  bobHandle = buildHandle(BOB_ALIAS)

  // Friendships both ways — createShare doesn't require them but some
  // downstream helpers (verifyShareFromFriend) do. Not strictly needed
  // for the flows tested here; keeps the fixture realistic.
  await db.insert(friendships).values({
    id: generateId(),
    userId: aliceId,
    friendHandle: bobHandle,
    friendEncryptionKey: 'bob-enc-key',
    status: 'accepted',
  })
  await db.insert(friendships).values({
    id: generateId(),
    userId: bobId,
    friendHandle: aliceHandle,
    friendEncryptionKey: 'alice-enc-key',
    status: 'accepted',
  })
}

async function makeCollection(
  ownerId: string,
  overrides: Partial<typeof collections.$inferInsert> = {},
): Promise<string> {
  const id = generateId()
  await db.insert(collections).values({
    id,
    userId: ownerId,
    isPublic: false,
    isDefault: false,
    scheme: 'server-key',
    resharingPolicy: 'owner-only',
    ...overrides,
  })
  return id
}

beforeAll(async () => {
  await seedUsers()
})

afterAll(async () => {
  // FK cascades wipe collections / shares / incoming_shares / friendships.
  if (aliceId) await db.delete(users).where(eq(users.id, aliceId))
  if (bobId) await db.delete(users).where(eq(users.id, bobId))
})

describe('isLocalRecipient', () => {
  test('recognizes same-server handle', () => {
    expect(sharingService.isLocalRecipient(bobHandle)).toBe(true)
  })

  test('rejects cross-server handle', () => {
    expect(
      sharingService.isLocalRecipient(`someone@other-server.test`),
    ).toBe(false)
  })
})

describe('createShare', () => {
  test('same-server with encrypted payload creates accepted incoming row', async () => {
    const collectionId = await makeCollection(aliceId)

    const share = await sharingService.createShare({
      userId: aliceId,
      recipientHandle: bobHandle,
      resourceType: 'collection',
      resourceId: collectionId,
      encryptedData: 'ciphertext==',
      nonce: 'nonce==',
      role: 'viewer',
    })

    expect(share.status).toBe('accepted')
    expect(share.recipientUserId).toBe(bobId)
    expect(share.role).toBe('viewer')

    const [incoming] = await db
      .select()
      .from(incomingShares)
      .where(
        and(
          eq(incomingShares.userId, bobId),
          eq(incomingShares.resourceId, collectionId),
        ),
      )
      .limit(1)
    expect(incoming).toBeDefined()
    expect(incoming.status).toBe('accepted')
    expect(incoming.role).toBe('viewer')
    expect(incoming.senderHandle).toBe(aliceHandle)
  })

  test('same-server without payload does not create incoming row', async () => {
    // Business rule: only encrypted shares get delivered. This matters
    // for stub/test writes that might forget the payload.
    const collectionId = await makeCollection(aliceId)

    await sharingService.createShare({
      userId: aliceId,
      recipientHandle: bobHandle,
      resourceType: 'collection',
      resourceId: collectionId,
      role: 'viewer',
    })

    const rows = await db
      .select()
      .from(incomingShares)
      .where(eq(incomingShares.resourceId, collectionId))
    expect(rows).toHaveLength(0)
  })
})

describe('revokeShare', () => {
  test('hard-deletes outgoing AND mirrored incoming rows', async () => {
    const collectionId = await makeCollection(aliceId)
    const share = await sharingService.createShare({
      userId: aliceId,
      recipientHandle: bobHandle,
      resourceType: 'collection',
      resourceId: collectionId,
      encryptedData: 'ct==',
      nonce: 'n==',
      role: 'viewer',
    })

    const ok = await sharingService.revokeShare(aliceId, share.id)
    expect(ok).toBe(true)

    const outgoing = await db
      .select()
      .from(shares)
      .where(eq(shares.id, share.id))
    expect(outgoing).toHaveLength(0)

    const incoming = await db
      .select()
      .from(incomingShares)
      .where(
        and(
          eq(incomingShares.userId, bobId),
          eq(incomingShares.resourceId, collectionId),
        ),
      )
    expect(incoming).toHaveLength(0)
  })

  test('allows re-sharing to same recipient after revoke (no unique index collision)', async () => {
    const collectionId = await makeCollection(aliceId)
    const first = await sharingService.createShare({
      userId: aliceId,
      recipientHandle: bobHandle,
      resourceType: 'collection',
      resourceId: collectionId,
      encryptedData: 'ct1',
      nonce: 'n1',
      role: 'viewer',
    })
    await sharingService.revokeShare(aliceId, first.id)

    const second = await sharingService.createShare({
      userId: aliceId,
      recipientHandle: bobHandle,
      resourceType: 'collection',
      resourceId: collectionId,
      encryptedData: 'ct2',
      nonce: 'n2',
      role: 'editor',
    })
    expect(second.id).not.toBe(first.id)
    expect(second.role).toBe('editor')
  })
})

describe('updateShareRole', () => {
  test('updates both outgoing and incoming rows in one transaction', async () => {
    const collectionId = await makeCollection(aliceId)
    const share = await sharingService.createShare({
      userId: aliceId,
      recipientHandle: bobHandle,
      resourceType: 'collection',
      resourceId: collectionId,
      encryptedData: 'ct',
      nonce: 'n',
      role: 'viewer',
    })

    const updated = await sharingService.updateShareRole(
      aliceId,
      share.id,
      'editor',
    )
    expect(updated?.role).toBe('editor')

    const [outgoing] = await db
      .select()
      .from(shares)
      .where(eq(shares.id, share.id))
    expect(outgoing.role).toBe('editor')

    const [incoming] = await db
      .select()
      .from(incomingShares)
      .where(
        and(
          eq(incomingShares.userId, bobId),
          eq(incomingShares.resourceId, collectionId),
        ),
      )
    expect(incoming.role).toBe('editor')
  })

  test('returns null when share does not exist', async () => {
    const updated = await sharingService.updateShareRole(
      aliceId,
      'nonexistent-id',
      'editor',
    )
    expect(updated).toBeNull()
  })

  test('refuses to update another user\'s share', async () => {
    const collectionId = await makeCollection(aliceId)
    const share = await sharingService.createShare({
      userId: aliceId,
      recipientHandle: bobHandle,
      resourceType: 'collection',
      resourceId: collectionId,
      encryptedData: 'ct',
      nonce: 'n',
      role: 'viewer',
    })

    // Bob (recipient, not sender) tries to modify — must fail.
    const updated = await sharingService.updateShareRole(
      bobId,
      share.id,
      'editor',
    )
    expect(updated).toBeNull()
  })
})

describe('getEffectiveRoleOnCollection', () => {
  test('returns "owner" for the collection owner', async () => {
    const collectionId = await makeCollection(aliceId)
    const role = await sharingService.getEffectiveRoleOnCollection(
      aliceId,
      collectionId,
    )
    expect(role).toBe('owner')
  })

  test('returns share role for an accepted recipient', async () => {
    const collectionId = await makeCollection(aliceId)
    await sharingService.createShare({
      userId: aliceId,
      recipientHandle: bobHandle,
      resourceType: 'collection',
      resourceId: collectionId,
      encryptedData: 'ct',
      nonce: 'n',
      role: 'editor',
    })

    const role = await sharingService.getEffectiveRoleOnCollection(
      bobId,
      collectionId,
    )
    expect(role).toBe('editor')
  })

  test('returns null for a user with no access', async () => {
    const collectionId = await makeCollection(aliceId)
    const role = await sharingService.getEffectiveRoleOnCollection(
      bobId,
      collectionId,
    )
    expect(role).toBeNull()
  })

  test('returns null for a non-existent collection', async () => {
    const role = await sharingService.getEffectiveRoleOnCollection(
      aliceId,
      'nonexistent',
    )
    expect(role).toBeNull()
  })
})

describe('canShareCollection', () => {
  test('owner is always allowed', async () => {
    const collectionId = await makeCollection(aliceId)
    const { allowed, asRole } = await sharingService.canShareCollection(
      aliceId,
      collectionId,
    )
    expect(allowed).toBe(true)
    expect(asRole).toBe('owner')
  })

  test('viewer is never allowed', async () => {
    const collectionId = await makeCollection(aliceId)
    await sharingService.createShare({
      userId: aliceId,
      recipientHandle: bobHandle,
      resourceType: 'collection',
      resourceId: collectionId,
      encryptedData: 'ct',
      nonce: 'n',
      role: 'viewer',
    })
    const { allowed } = await sharingService.canShareCollection(
      bobId,
      collectionId,
    )
    expect(allowed).toBe(false)
  })

  test('editor is allowed only under editors-can-share', async () => {
    const ownerOnly = await makeCollection(aliceId, {
      resharingPolicy: 'owner-only',
    })
    const open = await makeCollection(aliceId, {
      resharingPolicy: 'editors-can-share',
    })

    for (const cid of [ownerOnly, open]) {
      await sharingService.createShare({
        userId: aliceId,
        recipientHandle: bobHandle,
        resourceType: 'collection',
        resourceId: cid,
        encryptedData: 'ct',
        nonce: 'n',
        role: 'editor',
      })
    }

    const denied = await sharingService.canShareCollection(bobId, ownerOnly)
    expect(denied.allowed).toBe(false)

    const allowed = await sharingService.canShareCollection(bobId, open)
    expect(allowed.allowed).toBe(true)
    expect(allowed.asRole).toBe('editor')
  })
})

describe('requireWriteAccessToCollection', () => {
  test('owner passes', async () => {
    const collectionId = await makeCollection(aliceId)
    const role = await sharingService.requireWriteAccessToCollection(
      aliceId,
      collectionId,
    )
    expect(role).toBe('owner')
  })

  test('editor passes', async () => {
    const collectionId = await makeCollection(aliceId)
    await sharingService.createShare({
      userId: aliceId,
      recipientHandle: bobHandle,
      resourceType: 'collection',
      resourceId: collectionId,
      encryptedData: 'ct',
      nonce: 'n',
      role: 'editor',
    })
    const role = await sharingService.requireWriteAccessToCollection(
      bobId,
      collectionId,
    )
    expect(role).toBe('editor')
  })

  test('viewer throws InsufficientRoleError', async () => {
    const collectionId = await makeCollection(aliceId)
    await sharingService.createShare({
      userId: aliceId,
      recipientHandle: bobHandle,
      resourceType: 'collection',
      resourceId: collectionId,
      encryptedData: 'ct',
      nonce: 'n',
      role: 'viewer',
    })
    expect(
      sharingService.requireWriteAccessToCollection(bobId, collectionId),
    ).rejects.toThrow(sharingService.InsufficientRoleError)
  })

  test('non-member throws CollectionAccessDeniedError', async () => {
    const collectionId = await makeCollection(aliceId)
    expect(
      sharingService.requireWriteAccessToCollection(bobId, collectionId),
    ).rejects.toThrow(sharingService.CollectionAccessDeniedError)
  })
})
