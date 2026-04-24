/**
 * Unit tests for identity-reset.service.
 *
 * The real implementation touches ~15 tables inside a single transaction.
 * Rather than stub every table's row semantics, we just track which table
 * references the service called delete/update/select/insert on (via
 * drizzle's internal table symbol) and verify:
 *
 *   1. Every encrypted-data table gets a delete scoped to the target user.
 *   2. The users row keeps its alias, nulls keys, resets kmVersion.
 *   3. Before the wipe, peer handles from friendships + shares are
 *      snapshotted into `pending_revocations` so the client can drive
 *      RELATIONSHIP_REVOKE fan-out after re-registering new keys.
 *   4. Everything runs inside a single `db.transaction`.
 *
 * That's enough to catch the class of bug that actually bites here —
 * forgetting a table, writing to the wrong scope, losing the pre-wipe
 * snapshot that drives peer cleanup, or leaking the work outside the
 * transaction so a mid-reset failure leaves torn state.
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test'

type Op =
  | { kind: 'delete'; table: unknown; userId: string | null }
  | { kind: 'update-users'; values: Record<string, unknown>; userId: string | null }
  | { kind: 'insert'; table: unknown; rows: unknown[] }
  | { kind: 'select'; table: unknown }

let ops: Op[] = []
let transactionCallCount = 0

// Stubbed per-test: rows returned by the snapshot selects (friendships,
// shares, incomingShares, friendInvitations, users.alias). Default empty
// so the pre-wipe snapshot writes nothing unless a test opts in.
let selectResults: Map<unknown, unknown[]> = new Map()

// Capture-style fake. Each call records what table and filter were used,
// but returns `this` so the service's chained builder calls resolve.
function makeFake() {
  type PendingOp =
    | { kind: 'delete'; table: unknown }
    | { kind: 'update'; table: unknown; set: Record<string, unknown> | null }
    | { kind: 'select'; table: unknown | null }
    | { kind: 'insert'; table: unknown; rows: unknown[] | null }

  let op: PendingOp | null = null
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
    select(_fields?: unknown) {
      op = { kind: 'select', table: null }
      filterUserId = null
      return fake
    },
    from(table: unknown) {
      if (op && op.kind === 'select') op.table = table
      return fake
    },
    insert(table: unknown) {
      op = { kind: 'insert', table, rows: null }
      filterUserId = null
      return fake
    },
    values(rows: unknown | unknown[]) {
      if (op && op.kind === 'insert') {
        op.rows = Array.isArray(rows) ? rows : [rows]
      }
      return fake
    },
    onConflictDoNothing() {
      // Terminal for inserts — record and reset.
      if (op && op.kind === 'insert') {
        ops.push({ kind: 'insert', table: op.table, rows: op.rows ?? [] })
        op = null
      }
      return Promise.resolve()
    },
    limit(_n: number) {
      // Terminal for `.select().from().where().limit(n)`.
      return finalizeSelect()
    },
    set(values: Record<string, unknown>) {
      if (op && op.kind === 'update') op.set = values
      return fake
    },
    where(_predicate: unknown) {
      if (!op) return Promise.resolve()
      if (op.kind === 'delete') {
        ops.push({ kind: 'delete', table: op.table, userId: filterUserId })
        op = null
        return Promise.resolve()
      }
      if (op.kind === 'update') {
        ops.push({
          kind: 'update-users',
          values: op.set ?? {},
          userId: filterUserId,
        })
        op = null
        return Promise.resolve()
      }
      if (op.kind === 'select') {
        // `.select().from().where()` with no `.limit()` is the list form;
        // callers await the chain directly. Return a thenable that both
        // awaits into the stubbed rows AND still supports `.limit()` for
        // the single-row form that follows.
        const selectOp = op
        const chainable: any = {
          limit(_n: number) {
            op = selectOp
            return finalizeSelect()
          },
          then(
            onFulfilled: (v: unknown[]) => unknown,
            onRejected?: (e: unknown) => unknown,
          ) {
            return Promise.resolve(finalizeSelect()).then(
              onFulfilled,
              onRejected,
            )
          },
        }
        return chainable
      }
      return Promise.resolve()
    },
    async transaction(fn: (tx: unknown) => Promise<unknown>) {
      transactionCallCount += 1
      return fn(fake)
    },
  }

  function finalizeSelect(): unknown[] {
    if (op && op.kind === 'select' && op.table !== null) {
      ops.push({ kind: 'select', table: op.table })
      const rows = selectResults.get(op.table) ?? []
      op = null
      return rows
    }
    op = null
    return []
  }

  function setFilterUserId(id: string) {
    filterUserId = id
  }

  return { fake, setFilterUserId }
}

const { fake, setFilterUserId } = makeFake()

mock.module('../db', () => ({ db: fake }))
mock.module('../util', () => ({ generateId: () => 'mock-id' }))

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
import { pendingRevocations } from '../schema/pending-revocations.schema'

beforeEach(() => {
  ops = []
  transactionCallCount = 0
  selectResults = new Map()
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
    const scoped = ops.filter(
      (o) => o.kind === 'delete' || o.kind === 'update-users',
    ) as Array<{ userId: string | null }>
    for (const op of scoped) {
      expect(op.userId).toBe('u1')
    }
  })

  test('keeps alias, nulls keys, resets kmVersion on the users row', async () => {
    await resetUserIdentity('u1')
    const update = ops.find((o) => o.kind === 'update-users') as
      | { values: Record<string, unknown> }
      | undefined
    expect(update).toBeDefined()
    // Alias stays — same handle, new keys. Peers resolving the handle
    // pick up the new signingKey automatically.
    expect('alias' in update!.values).toBe(false)
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

  test('does NOT delete from the users table (row stays)', async () => {
    await resetUserIdentity('u1')
    const deletedTables = ops
      .filter((o) => o.kind === 'delete')
      .map((o) => (o as { table: unknown }).table)
    expect(deletedTables).not.toContain(users)
  })

  test('snapshots peer handles into pending_revocations BEFORE any delete', async () => {
    // Seed the pre-wipe selects so the snapshot captures a realistic set
    // of peers from each source. The order of entries within each source
    // doesn't matter; dedup is the service's job.
    selectResults.set(friendships, [{ handle: 'friend@remote.test' }])
    selectResults.set(shares, [{ handle: 'share-target@remote.test' }])
    selectResults.set(incomingShares, [{ handle: 'share-sender@remote.test' }])
    selectResults.set(friendInvitations, [
      { fromHandle: 'me@local.test', toHandle: 'invitee@remote.test' },
    ])
    selectResults.set(users, [{ alias: 'me' }])

    await resetUserIdentity('u1')

    const inserts = ops.filter((o) => o.kind === 'insert') as Array<{
      table: unknown
      rows: unknown[]
    }>
    const revocationInsert = inserts.find(
      (i) => i.table === pendingRevocations,
    )
    expect(revocationInsert).toBeDefined()

    const peerHandles = (revocationInsert!.rows as Array<{
      peerHandle: string
    }>).map((r) => r.peerHandle)

    // Every peer from every source is present, and the user's own
    // outgoing-invitation handle is NOT (it starts with their alias).
    expect(peerHandles).toContain('friend@remote.test')
    expect(peerHandles).toContain('share-target@remote.test')
    expect(peerHandles).toContain('share-sender@remote.test')
    expect(peerHandles).toContain('invitee@remote.test')
    expect(peerHandles).not.toContain('me@local.test')

    // Snapshot must run before any destructive delete against the tables
    // it reads from — otherwise the rows are gone by the time we list
    // them and the fan-out list is empty.
    const insertIdx = ops.indexOf(revocationInsert as Op)
    const firstDestructiveIdx = ops.findIndex(
      (o) =>
        o.kind === 'delete' &&
        (o.table === friendships ||
          o.table === shares ||
          o.table === incomingShares ||
          o.table === friendInvitations),
    )
    expect(insertIdx).toBeGreaterThan(-1)
    expect(firstDestructiveIdx).toBeGreaterThan(insertIdx)
  })

  test('skips the pending_revocations insert when no peers exist', async () => {
    // No seeded selects → every source returns empty; nothing to queue.
    // Still expect users-row alias lookup to run, but no revocation write.
    await resetUserIdentity('u1')
    const inserts = ops.filter(
      (o) => o.kind === 'insert' && o.table === pendingRevocations,
    )
    expect(inserts).toHaveLength(0)
  })

  test('dedupes peer handles that appear on multiple sources', async () => {
    // Alice is both a friend AND the recipient of a share AND sent us
    // one. The service should queue one revoke for her, not three.
    selectResults.set(friendships, [{ handle: 'alice@remote.test' }])
    selectResults.set(shares, [{ handle: 'alice@remote.test' }])
    selectResults.set(incomingShares, [{ handle: 'alice@remote.test' }])
    selectResults.set(users, [{ alias: 'me' }])

    await resetUserIdentity('u1')

    const inserts = ops.filter(
      (o) => o.kind === 'insert' && o.table === pendingRevocations,
    ) as Array<{ rows: unknown[] }>
    expect(inserts).toHaveLength(1)
    const handles = (inserts[0].rows as Array<{ peerHandle: string }>).map(
      (r) => r.peerHandle,
    )
    expect(handles).toEqual(['alice@remote.test'])
  })
})
