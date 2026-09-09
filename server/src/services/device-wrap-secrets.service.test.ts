/**
 * Unit tests for device-wrap-secrets.service.
 *
 * Mocks the db module so the tests exercise service logic (idempotency,
 * rotation scope, deletion scope) without a live Postgres. Matches the
 * mock pattern used in `location-e2ee.service.test.ts`.
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test'

interface Row {
  userId: string
  deviceId: string
  secret: string
  rotatedAt: Date
}

let store: Row[] = []

// A tiny fake Drizzle query builder that understands the subset of calls
// the service actually makes. Each method returns `this` so we can chain
// freely, and the terminal call (`.returning()`, `.where()` on select, etc.)
// resolves against `store`.
function makeFakeDb() {
  let op: 'insert' | 'update' | 'delete' | 'select' | null = null
  let pendingValues: Partial<Row> | null = null
  let pendingSet: Partial<Row> | null = null
  let pendingSelectProjection: 'row' | 'deviceId' | null = null
  let onConflictNoop = false
  let filterUserId: string | null = null
  let filterDeviceId: string | null = null

  function reset() {
    op = null
    pendingValues = null
    pendingSet = null
    pendingSelectProjection = null
    onConflictNoop = false
    filterUserId = null
    filterDeviceId = null
  }

  // The service calls and/eq to build WHERE clauses. We stub both so the
  // service builds real predicate objects, then we interpret the resulting
  // clause ourselves via the filter* fields captured during chaining.
  // Since we can't actually introspect Drizzle's SQL-builder objects from
  // here, the fake relies on the service calling `.where(and(eq(userId),
  // eq(deviceId)))` with deterministic ordering — which it does. We reach
  // into the internal filter state by hooking `eq` and `and` (see below).
  const fakeDb: any = {
    insert(_table: unknown) {
      reset()
      op = 'insert'
      return fakeDb
    },
    values(v: Partial<Row>) {
      pendingValues = v
      return fakeDb
    },
    onConflictDoNothing() {
      onConflictNoop = true
      return fakeDb
    },
    select(projection?: Record<string, unknown>) {
      reset()
      op = 'select'
      pendingSelectProjection =
        projection && 'deviceId' in projection ? 'deviceId' : 'row'
      return fakeDb
    },
    from(_table: unknown) {
      return fakeDb
    },
    update(_table: unknown) {
      reset()
      op = 'update'
      return fakeDb
    },
    set(v: Partial<Row>) {
      pendingSet = v
      return fakeDb
    },
    delete(_table: unknown) {
      reset()
      op = 'delete'
      return fakeDb
    },
    where(_predicate: unknown) {
      return applyTerminal()
    },
    returning() {
      return applyTerminal()
    },
    // Drizzle's `db.transaction(fn)` passes the fn a tx object that
    // has the same query methods. Our fake uses a single shared
    // mutable state, so `tx` === `fakeDb` is sufficient.
    async transaction(fn: (tx: unknown) => Promise<unknown>) {
      return fn(fakeDb)
    },
  }

  function applyTerminal(): Promise<unknown> {
    switch (op) {
      case 'insert': {
        const v = pendingValues as Row
        const clash = store.find(
          (r) => r.userId === v.userId && r.deviceId === v.deviceId,
        )
        if (clash) {
          if (onConflictNoop) return Promise.resolve([])
          throw new Error('duplicate key')
        }
        const inserted: Row = {
          userId: v.userId,
          deviceId: v.deviceId,
          secret: v.secret ?? 'missing',
          rotatedAt: v.rotatedAt ?? new Date(0),
        }
        store.push(inserted)
        return Promise.resolve([inserted])
      }
      case 'select': {
        const matches = store.filter(
          (r) =>
            (filterUserId === null || r.userId === filterUserId) &&
            (filterDeviceId === null || r.deviceId === filterDeviceId),
        )
        if (pendingSelectProjection === 'deviceId') {
          return Promise.resolve(matches.map((r) => ({ deviceId: r.deviceId })))
        }
        return Promise.resolve(matches.map((r) => ({ ...r })))
      }
      case 'update': {
        let count = 0
        for (const r of store) {
          if (
            (filterUserId === null || r.userId === filterUserId) &&
            (filterDeviceId === null || r.deviceId === filterDeviceId)
          ) {
            if (pendingSet?.secret !== undefined) r.secret = pendingSet.secret
            r.rotatedAt = new Date()
            count += 1
          }
        }
        return Promise.resolve({ count })
      }
      case 'delete': {
        const before = store.length
        store = store.filter(
          (r) =>
            !(
              (filterUserId === null || r.userId === filterUserId) &&
              (filterDeviceId === null || r.deviceId === filterDeviceId)
            ),
        )
        return Promise.resolve({ count: before - store.length })
      }
      default:
        return Promise.resolve([])
    }
  }

  // Hooks that `and` / `eq` (see mock.module below) use to push filter
  // state into the fake. A real Drizzle query builds opaque SQL AST; here
  // we just record which userId / deviceId the caller is constraining by.
  function setFilterUserId(id: string) {
    filterUserId = id
  }
  function setFilterDeviceId(id: string) {
    filterDeviceId = id
  }

  return { fakeDb, setFilterUserId, setFilterDeviceId, reset }
}

const fake = makeFakeDb()

mock.module('../db', () => ({ db: fake.fakeDb }))

// Capture-style fakes for drizzle-orm. The service calls `eq(col, val)`
// where `col` is the column ref. We pattern-match by inspecting the
// column metadata's `.name` (Drizzle exposes this on its column objects).
mock.module('drizzle-orm', () => {
  const eq = (col: { name?: string } | unknown, val: unknown) => {
    const name = (col as { name?: string })?.name
    if (name === 'user_id') fake.setFilterUserId(val as string)
    if (name === 'device_id') fake.setFilterDeviceId(val as string)
    return { _kind: 'eq', name, val }
  }
  const and = (...parts: unknown[]) => ({ _kind: 'and', parts })
  // The service uses `sql\`now()\`` inside `.set()`; it never reaches the
  // real driver because our fake skips that path. Return anything.
  const sql = (_strings: TemplateStringsArray, ..._values: unknown[]) => ({
    _kind: 'sql',
  })
  return { eq, and, sql }
})

// Imports after mocks are installed.
import {
  getOrCreateDeviceWrapSecret,
  rotateAllForUser,
  deleteForDevice,
} from './device-wrap-secrets.service'

beforeEach(() => {
  store = []
  fake.reset()
})

describe('getOrCreateDeviceWrapSecret', () => {
  test('creates a new row on first call', async () => {
    const s = await getOrCreateDeviceWrapSecret('u1', 'd1')
    expect(typeof s).toBe('string')
    expect(Buffer.from(s, 'base64').length).toBe(32)
    expect(store.length).toBe(1)
  })

  test('returns the same secret on repeated calls (idempotent)', async () => {
    const first = await getOrCreateDeviceWrapSecret('u1', 'd1')
    const second = await getOrCreateDeviceWrapSecret('u1', 'd1')
    expect(second).toBe(first)
    expect(store.length).toBe(1)
  })

  test('different devices for the same user get distinct secrets', async () => {
    const a = await getOrCreateDeviceWrapSecret('u1', 'd1')
    const b = await getOrCreateDeviceWrapSecret('u1', 'd2')
    expect(a).not.toBe(b)
    expect(store.length).toBe(2)
  })
})

describe('rotateAllForUser', () => {
  test('replaces every secret owned by the user', async () => {
    const s1 = await getOrCreateDeviceWrapSecret('u1', 'd1')
    const s2 = await getOrCreateDeviceWrapSecret('u1', 'd2')

    await rotateAllForUser('u1')

    const rotated1 = store.find((r) => r.deviceId === 'd1')!
    const rotated2 = store.find((r) => r.deviceId === 'd2')!
    expect(rotated1.secret).not.toBe(s1)
    expect(rotated2.secret).not.toBe(s2)
    expect(rotated1.secret).not.toBe(rotated2.secret)
  })

  test('leaves other users untouched', async () => {
    const mine = await getOrCreateDeviceWrapSecret('u1', 'd1')
    const theirs = await getOrCreateDeviceWrapSecret('u2', 'd1')

    await rotateAllForUser('u1')

    const mineRow = store.find((r) => r.userId === 'u1')!
    const theirsRow = store.find((r) => r.userId === 'u2')!
    expect(mineRow.secret).not.toBe(mine)
    expect(theirsRow.secret).toBe(theirs)
  })

  test('is a no-op when the user has no rows', async () => {
    await expect(rotateAllForUser('nobody')).resolves.toBeUndefined()
    expect(store.length).toBe(0)
  })
})

describe('deleteForDevice', () => {
  test('removes only the targeted row', async () => {
    await getOrCreateDeviceWrapSecret('u1', 'd1')
    await getOrCreateDeviceWrapSecret('u1', 'd2')
    await getOrCreateDeviceWrapSecret('u2', 'd1')

    await deleteForDevice('u1', 'd1')

    expect(store.find((r) => r.userId === 'u1' && r.deviceId === 'd1')).toBeUndefined()
    expect(store.find((r) => r.userId === 'u1' && r.deviceId === 'd2')).toBeDefined()
    expect(store.find((r) => r.userId === 'u2' && r.deviceId === 'd1')).toBeDefined()
  })
})
