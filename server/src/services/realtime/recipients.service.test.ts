/**
 * DB-backed tests for the recipient resolvers.
 *
 * Seeds throwaway users + a shared collection, then verifies each
 * resolver returns the right split of local userIds and remote handles.
 */

import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
} from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { users } from '../../schema/users.schema'
import { collections } from '../../schema/library.schema'
import { shares, incomingShares } from '../../schema/shares.schema'
import { friendships } from '../../schema/friendships.schema'
import { generateId } from '../../util'
import { buildHandle } from '../federation.service'
import {
  resolveCollectionRecipients,
  resolveFriendshipRecipients,
  resolvePublicLinkRecipients,
} from './recipients.service'

const RUN_SUFFIX = Math.random().toString(36).slice(2, 8)
const ALIAS_A = `rt_a_${RUN_SUFFIX}`
const ALIAS_B = `rt_b_${RUN_SUFFIX}`
let idA = ''
let idB = ''
let handleA = ''
let handleB = ''

beforeAll(async () => {
  idA = generateId()
  idB = generateId()
  await db.insert(users).values({
    id: idA,
    email: `rt-a-${RUN_SUFFIX}@parchment.test`,
    alias: ALIAS_A,
    signingKey: 'sig-a',
    encryptionKey: 'enc-a',
  })
  await db.insert(users).values({
    id: idB,
    email: `rt-b-${RUN_SUFFIX}@parchment.test`,
    alias: ALIAS_B,
    signingKey: 'sig-b',
    encryptionKey: 'enc-b',
  })
  handleA = buildHandle(ALIAS_A)
  handleB = buildHandle(ALIAS_B)
})

afterAll(async () => {
  if (idA) await db.delete(users).where(eq(users.id, idA))
  if (idB) await db.delete(users).where(eq(users.id, idB))
})

async function makeCollection(ownerId: string): Promise<string> {
  const id = generateId()
  await db.insert(collections).values({
    id,
    userId: ownerId,
    isPublic: false,
    scheme: 'server-key',
    resharingPolicy: 'owner-only',
  })
  return id
}

describe('resolveCollectionRecipients', () => {
  test('owner-only for an unshared collection', async () => {
    const coll = await makeCollection(idA)
    const r = await resolveCollectionRecipients(coll)
    expect(r.localUserIds).toEqual([idA])
    expect(r.remoteHandles).toEqual([])
  })

  test('owner + same-server recipient via incoming_shares', async () => {
    const coll = await makeCollection(idA)
    await db.insert(incomingShares).values({
      id: generateId(),
      userId: idB,
      senderHandle: handleA,
      resourceType: 'collection',
      resourceId: coll,
      encryptedData: 'ct',
      nonce: 'n',
      role: 'viewer',
      status: 'accepted',
    })
    const r = await resolveCollectionRecipients(coll)
    expect(new Set(r.localUserIds)).toEqual(new Set([idA, idB]))
    expect(r.remoteHandles).toEqual([])
  })

  test('cross-server recipient ends up in remoteHandles', async () => {
    const coll = await makeCollection(idA)
    await db.insert(shares).values({
      id: generateId(),
      userId: idA,
      recipientHandle: 'eve@peer.test',
      recipientUserId: null,
      resourceType: 'collection',
      resourceId: coll,
      role: 'viewer',
      status: 'pending',
    })
    const r = await resolveCollectionRecipients(coll)
    expect(r.localUserIds).toEqual([idA])
    expect(r.remoteHandles).toEqual(['eve@peer.test'])
  })

  test('missing collection returns empty', async () => {
    const r = await resolveCollectionRecipients('does-not-exist')
    expect(r.localUserIds).toEqual([])
    expect(r.remoteHandles).toEqual([])
  })
})

describe('resolveFriendshipRecipients', () => {
  test('both sides local', async () => {
    const r = await resolveFriendshipRecipients(idA, { userId: idB })
    expect(new Set(r.localUserIds)).toEqual(new Set([idA, idB]))
    expect(r.remoteHandles).toEqual([])
  })

  test('local + remote handle splits', async () => {
    const r = await resolveFriendshipRecipients(idA, {
      handle: 'bob@peer.test',
    })
    expect(r.localUserIds).toEqual([idA])
    expect(r.remoteHandles).toEqual(['bob@peer.test'])
  })

  test('local handle resolves to userId', async () => {
    const r = await resolveFriendshipRecipients(idA, { handle: handleB })
    expect(new Set(r.localUserIds)).toEqual(new Set([idA, idB]))
    expect(r.remoteHandles).toEqual([])
  })
})

describe('resolvePublicLinkRecipients', () => {
  test('owner only', async () => {
    const coll = await makeCollection(idA)
    const r = await resolvePublicLinkRecipients(coll)
    expect(r.localUserIds).toEqual([idA])
    expect(r.remoteHandles).toEqual([])
  })

  test('unknown collection returns empty', async () => {
    const r = await resolvePublicLinkRecipients('none')
    expect(r).toEqual({ localUserIds: [], remoteHandles: [] })
  })

  // Keep friendship fixture silencing — this table is cleaned via users cascade.
  void friendships
})
