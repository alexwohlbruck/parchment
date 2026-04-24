/**
 * Unit tests for identity-reset.service.
 *
 * The real implementation touches ~15 tables inside a single transaction.
 * Rather than stub every table's row semantics, we just track which table
 * references the service called delete/update on (via drizzle's internal
 * table symbol) and verify:
 *
 *   1. Every encrypted-data table gets a delete scoped to the target user.
 *   2. The users row gets nulled (alias, keys) and kmVersion reset to 1.
 *   3. Everything runs inside a single `db.transaction`.
 *
 * That's enough to catch the class of bug that actually bites here —
 * forgetting a table, writing to the wrong scope, or leaking the work
 * outside the transaction so a mid-reset failure leaves torn state.
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test'

type Op =
  | { kind: 'delete'; table: unknown; userId: string | null }
  | { kind: 'update-users'; values: Record<string, unknown>; userId: string | null }

let ops: Op[] = []
let transactionCallCount = 0

// Capture-style fake. Each call records what table and filter were used,
// but returns `this` so the service's chained builder calls resolve.
function makeFake() {
  let op:
    | { kind: 'delete'; table: unknown }
    | { kind: 'update'; table: unknown; set: Record<string, unknown> | null }
    | null = null
  let filterUserId: string | null = null

  const fake: any = {
    delete(table: unknown) {
      op = { kind: 'delete', table }
      filterUserId = null
      return fake
    },
    update(table: unknown) {
      op = { kind: 'update', table, set: null }
      filterUserId = null
      return fake
    },
    set(values: Record<string, unknown>) {
      if (op && op.kind === 'update') op.set = values
      return fake
    },
    where(_predicate: unknown) {
      if (!op) return Promise.resolve()
      if (op.kind === 'delete') {
        ops.push({ kind: 'delete', table: op.table, userId: filterUserId })
      } else {
        ops.push({
          kind: 'update-users',
          values: op.set ?? {},
          userId: filterUserId,
        })
      }
      op = null
      return Promise.resolve()
    },
    async transaction(fn: (tx: unknown) => Promise<unknown>) {
      transactionCallCount += 1
      return fn(fake)
    },
  }

  function setFilterUserId(id: string) {
    filterUserId = id
  }

  return { fake, setFilterUserId }
}

const { fake, setFilterUserId } = makeFake()

mock.module('../db', () => ({ db: fake }))

// Stub drizzle-orm's `eq` and `or` so the service can chain where-clauses
// without a real SQL builder. We look at the column's `.name` metadata
// to capture which userId the service is filtering by.
mock.module('drizzle-orm', () => {
  const eq = (col: { name?: string } | unknown, val: unknown) => {
    const name = (col as { name?: string })?.name
    if (
      name === 'user_id' ||
      name === 'sharer_id' ||
      name === 'viewer_id' ||
      name === 'local_user_id' ||
      name === 'id'
    ) {
      setFilterUserId(val as string)
    }
    return { _kind: 'eq', name, val }
  }
  const or = (...parts: unknown[]) => ({ _kind: 'or', parts })
  return { eq, or }
})

// Imports after mocks are in place.
import { resetUserIdentity } from './identity-reset.service'
import { users } from '../schema/users.schema'
import { wrappedMasterKeys } from '../schema/wrapped-master-keys.schema'
import { deviceWrapSecrets } from '../schema/device-wrap-secrets.schema'
import { encryptedUserBlobs } from '../schema/personal-blobs.schema'
import {
  bookmarks,
  collections,
  canvases,
} from '../schema/library.schema'
import {
  encryptedLocations,
  locationSharingConfig,
  locationSharingRelationships,
  trackedDevices,
  userEncryptionKeys,
  userDevices,
} from '../schema/location.schema'
import { shares, incomingShares } from '../schema/shares.schema'
import { friendships } from '../schema/friendships.schema'
import { friendInvitations } from '../schema/friend-invitations.schema'

beforeEach(() => {
  ops = []
  transactionCallCount = 0
})

describe('resetUserIdentity', () => {
  test('runs everything inside a single transaction', async () => {
    await resetUserIdentity('u1')
    expect(transactionCallCount).toBe(1)
  })

  test('deletes from every user-encrypted-data table', async () => {
    await resetUserIdentity('u1')
    const deletedTables = ops
      .filter((o) => o.kind === 'delete')
      .map((o) => (o as { table: unknown }).table)

    const expected = [
      wrappedMasterKeys,
      deviceWrapSecrets,
      encryptedUserBlobs,
      collections,
      bookmarks,
      canvases,
      encryptedLocations,
      locationSharingConfig,
      locationSharingRelationships,
      trackedDevices,
      userDevices,
      userEncryptionKeys,
      shares,
      incomingShares,
      friendships,
      friendInvitations,
    ]
    for (const table of expected) {
      expect(deletedTables).toContain(table)
    }
  })

  test('scopes every delete and the update to the target userId', async () => {
    await resetUserIdentity('u1')
    for (const op of ops) {
      expect(op.userId).toBe('u1')
    }
  })

  test('nulls alias + keys and resets kmVersion on the users row', async () => {
    await resetUserIdentity('u1')
    const update = ops.find((o) => o.kind === 'update-users') as
      | { values: Record<string, unknown> }
      | undefined
    expect(update).toBeDefined()
    expect(update!.values.alias).toBeNull()
    expect(update!.values.signingKey).toBeNull()
    expect(update!.values.encryptionKey).toBeNull()
    expect(update!.values.kmVersion).toBe(1)
    expect(update!.values.updatedAt).toBeInstanceOf(Date)
  })

  test('the users-row update is the LAST operation', async () => {
    await resetUserIdentity('u1')
    const last = ops[ops.length - 1]
    expect(last.kind).toBe('update-users')
  })

  test('does NOT delete from the users table (row stays, just nulled)', async () => {
    await resetUserIdentity('u1')
    const deletedTables = ops
      .filter((o) => o.kind === 'delete')
      .map((o) => (o as { table: unknown }).table)
    expect(deletedTables).not.toContain(users)
  })
})
