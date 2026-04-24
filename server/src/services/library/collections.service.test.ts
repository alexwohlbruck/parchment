/**
 * Tests for the collections service.
 *
 * Pure-error classes are tested inline with no fixtures. The DB-backed
 * flow tests (access, delete cascade, CAS, rotate, scheme switch, public
 * link) seed throwaway users per run and tear them down in afterAll.
 */

import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
} from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { db } from '../../db'
import { users } from '../../schema/users.schema'
import {
  collections,
  encryptedPoints,
  bookmarks as bookmarksSchema,
  bookmarksCollections,
} from '../../schema/library.schema'
import { shares, incomingShares } from '../../schema/shares.schema'
import { generateId } from '../../util'
import { buildHandle } from '../federation.service'
import * as sharingService from '../sharing.service'
import {
  PublicLinkNotAllowedOnE2eeError,
  RotationVersionError,
  SchemeAlreadySetError,
  CollectionVersionConflictError,
  getAccessibleCollection,
  getSharedCollections,
  deleteCollection,
  createPublicLink,
  revokePublicLink,
  getPublicCollectionByToken,
  rotateCollectionKey,
  changeCollectionScheme,
} from './collections.service'

describe('PublicLinkNotAllowedOnE2eeError', () => {
  test('has a useful name and message', () => {
    const err = new PublicLinkNotAllowedOnE2eeError()
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('PublicLinkNotAllowedOnE2eeError')
    expect(err.message).toContain('server-key')
  })
})

describe('RotationVersionError', () => {
  test('captures both current and proposed version in the message', () => {
    const err = new RotationVersionError(3, 2)
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('RotationVersionError')
    expect(err.message).toContain('3')
    expect(err.message).toContain('2')
  })
})

describe('SchemeAlreadySetError', () => {
  test('reports the scheme that matched current state', () => {
    const err = new SchemeAlreadySetError('user-e2ee')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('SchemeAlreadySetError')
    expect(err.message).toContain('user-e2ee')
  })
})

describe('CollectionVersionConflictError', () => {
  test('captures both observed and expected timestamps', () => {
    const now = new Date('2026-04-24T17:00:00.000Z')
    const err = new CollectionVersionConflictError(
      now,
      '2026-01-01T00:00:00.000Z',
    )
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('CollectionVersionConflictError')
    expect(err.message).toContain('2026-04-24T17:00:00.000Z')
    expect(err.message).toContain('2026-01-01T00:00:00.000Z')
  })
})

// ===========================================================================
// DB-backed flow tests
// ===========================================================================

const RUN_SUFFIX = Math.random().toString(36).slice(2, 8)
const ALICE_ALIAS = `c_alice_${RUN_SUFFIX}`
const BOB_ALIAS = `c_bob_${RUN_SUFFIX}`

let aliceId = ''
let bobId = ''
let aliceHandle = ''
let bobHandle = ''

beforeAll(async () => {
  aliceId = generateId()
  bobId = generateId()
  await db.insert(users).values({
    id: aliceId,
    email: `c-alice-${RUN_SUFFIX}@parchment.test`,
    alias: ALICE_ALIAS,
    signingKey: 'alice-sig',
    encryptionKey: 'alice-enc',
  })
  await db.insert(users).values({
    id: bobId,
    email: `c-bob-${RUN_SUFFIX}@parchment.test`,
    alias: BOB_ALIAS,
    signingKey: 'bob-sig',
    encryptionKey: 'bob-enc',
  })
  aliceHandle = buildHandle(ALICE_ALIAS)
  bobHandle = buildHandle(BOB_ALIAS)
})

afterAll(async () => {
  if (aliceId) await db.delete(users).where(eq(users.id, aliceId))
  if (bobId) await db.delete(users).where(eq(users.id, bobId))
})

async function makeCollection(
  ownerId: string,
  overrides: Partial<typeof collections.$inferInsert> = {},
): Promise<string> {
  const id = generateId()
  await db.insert(collections).values({
    id,
    userId: ownerId,
    isPublic: false,
    scheme: 'server-key',
    resharingPolicy: 'owner-only',
    ...overrides,
  })
  return id
}

async function shareWith(
  ownerId: string,
  recipientHandle: string,
  collectionId: string,
  role: 'viewer' | 'editor',
) {
  return await sharingService.createShare({
    userId: ownerId,
    recipientHandle,
    resourceType: 'collection',
    resourceId: collectionId,
    encryptedData: 'ct',
    nonce: 'n',
    role,
  })
}

describe('getAccessibleCollection', () => {
  test('owner receives role=owner', async () => {
    const id = await makeCollection(aliceId)
    const c = await getAccessibleCollection(id, aliceId)
    expect(c).toBeTruthy()
    expect(c?.role).toBe('owner')
  })

  test('recipient receives their share role', async () => {
    const id = await makeCollection(aliceId)
    await shareWith(aliceId, bobHandle, id, 'editor')

    const c = await getAccessibleCollection(id, bobId)
    expect(c).toBeTruthy()
    expect(c?.role).toBe('editor')
    expect(c?.userId).toBe(aliceId)
  })

  test('non-member receives null (do not leak existence)', async () => {
    const id = await makeCollection(aliceId)
    const c = await getAccessibleCollection(id, bobId)
    expect(c).toBeNull()
  })
})

describe('getSharedCollections', () => {
  test('returns joined rows with role; excludes owned', async () => {
    const shared = await makeCollection(aliceId)
    await shareWith(aliceId, bobHandle, shared, 'viewer')
    // Create another Alice-owned collection NOT shared with Bob — must be absent.
    await makeCollection(aliceId)

    const rows = await getSharedCollections(bobId)
    const match = rows.find((r) => r.id === shared)
    expect(match).toBeDefined()
    expect(match?.role).toBe('viewer')
    // Bob's own library (owned collections) should not appear here.
    expect(rows.every((r) => r.userId !== bobId)).toBe(true)
  })

  test('empty array when no shares exist', async () => {
    // A fresh user with no incoming shares.
    const rows = await getSharedCollections(aliceId)
    // Alice's owned collections MUST NOT appear here; this is recipient-only.
    expect(rows.every((r) => r.userId !== aliceId)).toBe(true)
  })
})

describe('deleteCollection', () => {
  test('cascades to shares + incoming_shares in one transaction', async () => {
    const id = await makeCollection(aliceId)
    await shareWith(aliceId, bobHandle, id, 'viewer')

    const before = {
      shares: (
        await db.select().from(shares).where(eq(shares.resourceId, id))
      ).length,
      incoming: (
        await db
          .select()
          .from(incomingShares)
          .where(eq(incomingShares.resourceId, id))
      ).length,
    }
    expect(before.shares).toBe(1)
    expect(before.incoming).toBe(1)

    const deleted = await deleteCollection(id, aliceId)
    expect(deleted).toBeTruthy()

    const after = {
      collection: (
        await db.select().from(collections).where(eq(collections.id, id))
      ).length,
      shares: (
        await db.select().from(shares).where(eq(shares.resourceId, id))
      ).length,
      incoming: (
        await db
          .select()
          .from(incomingShares)
          .where(eq(incomingShares.resourceId, id))
      ).length,
    }
    expect(after.collection).toBe(0)
    expect(after.shares).toBe(0)
    expect(after.incoming).toBe(0)
  })

})

describe('public link lifecycle', () => {
  test('mint, resolve, revoke', async () => {
    const id = await makeCollection(aliceId, {
      metadataEncrypted: 'envelope',
      metadataKeyVersion: 1,
    })

    const minted = await createPublicLink(id, aliceId)
    expect(minted?.publicToken).toMatch(/.{20,}/)
    expect(minted?.publicRole).toBe('viewer')

    const resolved = await getPublicCollectionByToken(minted!.publicToken)
    expect(resolved?.collection.id).toBe(id)

    const revoked = await revokePublicLink(id, aliceId)
    expect(revoked).toBe(true)

    const afterRevoke = await getPublicCollectionByToken(minted!.publicToken)
    expect(afterRevoke).toBeNull()
  })

  test('mint refuses user-e2ee collections', async () => {
    const id = await makeCollection(aliceId, {
      scheme: 'user-e2ee',
      isSensitive: true,
    })
    expect(createPublicLink(id, aliceId)).rejects.toThrow(
      PublicLinkNotAllowedOnE2eeError,
    )
  })

  test('returns null for non-owner mint attempts', async () => {
    const id = await makeCollection(aliceId)
    const result = await createPublicLink(id, bobId)
    expect(result).toBeNull()
  })
})

describe('rotateCollectionKey', () => {
  test('drops revoked recipient rows (outgoing + incoming) atomically', async () => {
    // Regression for a pre-existing bug: the incoming_shares delete was
    // matching sender_handle against the recipient's handle — it never
    // matched, so Bob's row persisted after rotate.
    const id = await makeCollection(aliceId, {
      scheme: 'user-e2ee',
      metadataKeyVersion: 1,
      metadataEncrypted: 'envelope-v1',
    })
    await shareWith(aliceId, bobHandle, id, 'viewer')

    await rotateCollectionKey({
      collectionId: id,
      userId: aliceId,
      newMetadataEncrypted: 'envelope-v2',
      newMetadataKeyVersion: 2,
      newEncryptedPoints: [],
      updatedShareEnvelopes: [],
      revokeRecipientHandles: [bobHandle],
    })

    const sharesAfter = await db
      .select()
      .from(shares)
      .where(eq(shares.resourceId, id))
    const incomingAfter = await db
      .select()
      .from(incomingShares)
      .where(eq(incomingShares.resourceId, id))
    expect(sharesAfter).toHaveLength(0)
    expect(incomingAfter).toHaveLength(0)

    const [after] = await db
      .select()
      .from(collections)
      .where(eq(collections.id, id))
    expect(after.metadataKeyVersion).toBe(2)
    expect(after.metadataEncrypted).toBe('envelope-v2')
  })

  test('throws RotationVersionError when new version does not advance', async () => {
    const id = await makeCollection(aliceId, {
      scheme: 'user-e2ee',
      metadataKeyVersion: 5,
      metadataEncrypted: 'v5',
    })
    expect(
      rotateCollectionKey({
        collectionId: id,
        userId: aliceId,
        newMetadataEncrypted: 'v5',
        newMetadataKeyVersion: 5, // same, must reject
        newEncryptedPoints: [],
        updatedShareEnvelopes: [],
        revokeRecipientHandles: [],
      }),
    ).rejects.toThrow(RotationVersionError)
  })

  test('updates remaining recipient envelopes', async () => {
    const id = await makeCollection(aliceId, {
      scheme: 'user-e2ee',
      metadataKeyVersion: 1,
      metadataEncrypted: 'env',
    })
    const share = await shareWith(aliceId, bobHandle, id, 'editor')

    await rotateCollectionKey({
      collectionId: id,
      userId: aliceId,
      newMetadataEncrypted: 'env2',
      newMetadataKeyVersion: 2,
      newEncryptedPoints: [],
      updatedShareEnvelopes: [
        {
          recipientHandle: bobHandle,
          encryptedData: 'new-ct',
          nonce: 'new-n',
        },
      ],
      revokeRecipientHandles: [],
    })

    const [updatedShare] = await db
      .select()
      .from(shares)
      .where(eq(shares.id, share.id))
    expect(updatedShare.encryptedData).toBe('new-ct')
    expect(updatedShare.nonce).toBe('new-n')

    const [updatedIncoming] = await db
      .select()
      .from(incomingShares)
      .where(
        and(
          eq(incomingShares.userId, bobId),
          eq(incomingShares.resourceId, id),
        ),
      )
    expect(updatedIncoming.encryptedData).toBe('new-ct')
    expect(updatedIncoming.nonce).toBe('new-n')
  })
})

describe('changeCollectionScheme', () => {
  test('throws SchemeAlreadySetError when target equals current', async () => {
    const id = await makeCollection(aliceId)
    expect(
      changeCollectionScheme({
        collectionId: id,
        userId: aliceId,
        targetScheme: 'server-key',
        newMetadataEncrypted: 'env',
        newMetadataKeyVersion: 2,
        updatedShareEnvelopes: [],
      }),
    ).rejects.toThrow(SchemeAlreadySetError)
  })

  test('CAS: stale expectedUpdatedAt throws CollectionVersionConflictError', async () => {
    const id = await makeCollection(aliceId)
    expect(
      changeCollectionScheme({
        collectionId: id,
        userId: aliceId,
        targetScheme: 'user-e2ee',
        newMetadataEncrypted: 'env',
        newMetadataKeyVersion: 2,
        updatedShareEnvelopes: [],
        expectedUpdatedAt: '2000-01-01T00:00:00.000Z',
      }),
    ).rejects.toThrow(CollectionVersionConflictError)
  })

  test('CAS: matching expectedUpdatedAt proceeds', async () => {
    const id = await makeCollection(aliceId)
    const [fresh] = await db
      .select()
      .from(collections)
      .where(eq(collections.id, id))
    const updatedIso = fresh.updatedAt.toISOString()

    const result = await changeCollectionScheme({
      collectionId: id,
      userId: aliceId,
      targetScheme: 'user-e2ee',
      newMetadataEncrypted: 'env-new',
      newMetadataKeyVersion: 2,
      newEncryptedPoints: [],
      updatedShareEnvelopes: [],
      expectedUpdatedAt: updatedIso,
    })
    expect(result?.scheme).toBe('user-e2ee')
  })

  test('upgrade moves bookmarks to encrypted_points + clears public token', async () => {
    const id = await makeCollection(aliceId, {
      publicToken: 'some-token',
      publicRole: 'viewer',
    })
    // Seed one bookmark tied to this collection.
    const bmId = generateId()
    await db.execute(
      // prettier-ignore
      `INSERT INTO bookmarks (id, external_ids, name, geometry, user_id)
       VALUES ('${bmId}', '{"osm":"way/1"}'::jsonb, 'Test', ST_SetSRID(ST_MakePoint(0,0), 4326), '${aliceId}')`,
    )
    await db
      .insert(bookmarksCollections)
      .values({ bookmarkId: bmId, collectionId: id })

    await changeCollectionScheme({
      collectionId: id,
      userId: aliceId,
      targetScheme: 'user-e2ee',
      newMetadataEncrypted: 'env-e2ee',
      newMetadataKeyVersion: 2,
      newEncryptedPoints: [
        { id: generateId(), encryptedData: 'ct', nonce: 'n' },
      ],
      updatedShareEnvelopes: [],
    })

    const [after] = await db
      .select()
      .from(collections)
      .where(eq(collections.id, id))
    expect(after.scheme).toBe('user-e2ee')
    expect(after.publicToken).toBeNull()
    expect(after.publicRole).toBeNull()

    const bms = await db
      .select()
      .from(bookmarksSchema)
      .where(eq(bookmarksSchema.id, bmId))
    expect(bms).toHaveLength(0)

    const points = await db
      .select()
      .from(encryptedPoints)
      .where(eq(encryptedPoints.collectionId, id))
    expect(points.length).toBe(1)
  })
})
