import { test, expect, beforeAll, afterAll } from 'bun:test'
import { inArray } from 'drizzle-orm'
import { db } from '../../db'
import { users } from '../../schema/users.schema'
import { collections } from '../../schema/library.schema'
import { incomingShares } from '../../schema/shares.schema'
import { generateId } from '../../util'
import {
  getOrganization,
  saveOrganization,
  OrganizationConflictError,
  OrganizationValidationError,
} from './collection-organization.service'

const aliceId = generateId()
const bobId = generateId()
const ownedId = generateId()
const sharedId = generateId()
const inaccessibleId = generateId()
const bobAlias = `groups-b-${bobId.slice(0, 8)}`

beforeAll(async () => {
  await db.insert(users).values([
    {
      id: aliceId,
      email: `${aliceId}@groups.test`,
      alias: `groups-a-${aliceId.slice(0, 8)}`,
    },
    { id: bobId, email: `${bobId}@groups.test`, alias: bobAlias },
  ])
  await db.insert(collections).values([
    { id: ownedId, userId: bobId, name: 'Owned' },
    { id: sharedId, userId: aliceId, name: 'Shared' },
    { id: inaccessibleId, userId: aliceId, name: 'Private' },
  ])
  await db.insert(incomingShares).values({
    id: generateId(),
    userId: bobId,
    senderHandle: 'alice@parchment.test',
    resourceType: 'collection',
    resourceId: sharedId,
    role: 'viewer',
    status: 'accepted',
    encryptedData: 'cipher',
    nonce: 'nonce',
  })
})

afterAll(async () => {
  await db.delete(users).where(inArray(users.id, [aliceId, bobId]))
})

test('persists personal nested groups for owned and viewer-shared collections', async () => {
  expect(await getOrganization(bobId)).toEqual({
    groups: [],
    placements: [],
    revision: 0,
  })
  const result = await saveOrganization(bobId, {
    revision: 0,
    groups: [
      { id: 'city', name: ' New York ', parentId: null },
      { id: 'food', name: 'Food', parentId: 'city' },
    ],
    placements: [
      { collectionId: ownedId, groupId: 'city' },
      { collectionId: sharedId, groupId: 'food' },
      { collectionId: inaccessibleId, groupId: 'city' },
    ],
  })
  expect(result.revision).toBe(1)
  expect(result.groups[0].name).toBe('New York')
  expect(result.placements.map((item) => item.collectionId)).toEqual([
    ownedId,
    sharedId,
  ])
  expect(await getOrganization(bobId)).toEqual(result)
  expect(await getOrganization(aliceId)).toEqual({
    groups: [],
    placements: [],
    revision: 0,
  })
  await expect(
    saveOrganization(bobId, { ...result, revision: 0 }),
  ).rejects.toBeInstanceOf(OrganizationConflictError)
  expect(await getOrganization(bobId)).toEqual(result)
})

test('rejects a cycle before modifying persisted groups', async () => {
  const current = await getOrganization(bobId)
  await expect(
    saveOrganization(bobId, {
      ...current,
      groups: [
        { id: 'a', name: 'A', parentId: 'b' },
        { id: 'b', name: 'B', parentId: 'a' },
      ],
    }),
  ).rejects.toBeInstanceOf(OrganizationValidationError)
  expect(await getOrganization(bobId)).toEqual(current)
})

test('only one concurrent save can use a revision', async () => {
  const current = await getOrganization(bobId)
  const results = await Promise.allSettled([
    saveOrganization(bobId, current),
    saveOrganization(bobId, current),
  ])
  expect(
    results.filter((result) => result.status === 'fulfilled'),
  ).toHaveLength(1)
  const rejected = results.find(
    (result) => result.status === 'rejected',
  ) as PromiseRejectedResult
  expect(rejected.reason).toBeInstanceOf(OrganizationConflictError)
})
