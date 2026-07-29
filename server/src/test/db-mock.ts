/**
 * Chainable stand-in for the Drizzle `db` handle.
 *
 * Some controllers and services query the database directly rather than going
 * through a service function, so their tests need a `db` that records writes
 * and hands back canned rows without a real Postgres.
 *
 *   import { createDbMock } from '../test/db-mock'
 *   const dbMock = createDbMock()
 *   mock.module('../db', () => ({ db: dbMock.db }))
 *
 *   dbMock.queueSelect([{ id: 'row-1' }])   // next select() resolves to this
 *   expect(dbMock.inserted).toEqual([...])  // values passed to .values()
 *
 * Drizzle chains are thenable at whatever point the caller stops — `.where()`,
 * `.limit()`, `.orderBy()`, `.returning()` — so every link returns an array
 * carrying the remaining chain methods. Awaiting any of them yields the rows.
 */

export interface DbMock {
  /** Pass to `mock.module('../db', () => ({ db: dbMock.db }))`. */
  db: any
  /** Rows for the *next* select only; queue several for multi-query functions. */
  queueSelect(rows: unknown[]): void
  /** Rows every un-queued select falls back to. */
  setSelectRows(rows: unknown[]): void
  /** Rows returned by `.returning()` after an insert or update. */
  setReturningRows(rows: unknown[]): void
  /**
   * Rows for the *next* `.returning()` only. Use when one handler issues
   * several writes whose results must differ — e.g. a conditional UPDATE that
   * matches zero rows, followed by a second write that matches one.
   */
  queueReturning(rows: unknown[]): void
  /** Values passed to each `insert().values(...)`. */
  inserted: unknown[]
  /** Values passed to each `update().set(...)`. */
  updated: unknown[]
  /** The `set` payload of each `onConflictDoUpdate`. */
  conflictUpdates: unknown[]
  /** Number of `delete()` statements issued. */
  deleteCount: number
  /** Number of `select()` statements issued. */
  selectCount: number
  /** Number of `insert()` statements issued. */
  insertCount: number
  /** Number of `update()` statements issued. */
  updateCount: number
  reset(): void
}

export function createDbMock(): DbMock {
  let selectQueue: unknown[][] = []
  let selectRows: unknown[] = []
  let returningQueue: unknown[][] = []
  let returningRows: unknown[] = []

  function nextReturningRows(): unknown[] {
    return returningQueue.length > 0 ? returningQueue.shift()! : returningRows
  }

  const state = {
    inserted: [] as unknown[],
    updated: [] as unknown[],
    conflictUpdates: [] as unknown[],
    deleteCount: 0,
    selectCount: 0,
    insertCount: 0,
    updateCount: 0,
  }

  /**
   * An array of `rows` that also answers every chain method with itself, so a
   * query can terminate at any link and still await to the same rows.
   */
  function chain(rows: unknown[]): any {
    const link: any = [...rows]
    const self = () => link
    Object.assign(link, {
      from: self,
      where: self,
      limit: self,
      offset: self,
      orderBy: self,
      groupBy: self,
      having: self,
      leftJoin: self,
      rightJoin: self,
      innerJoin: self,
      fullJoin: self,
      for: self,
      returning: () => chain(nextReturningRows()),
      onConflictDoNothing: self,
      onConflictDoUpdate: (config: any) => {
        state.conflictUpdates.push(config?.set)
        return link
      },
    })
    return link
  }

  function nextSelectRows(): unknown[] {
    return selectQueue.length > 0 ? selectQueue.shift()! : selectRows
  }

  const db = {
    select: (_fields?: unknown) => {
      state.selectCount++
      return chain(nextSelectRows())
    },
    selectDistinct: (_fields?: unknown) => {
      state.selectCount++
      return chain(nextSelectRows())
    },
    insert: (_table: unknown) => {
      state.insertCount++
      return {
        values: (values: unknown) => {
          state.inserted.push(values)
          return chain([])
        },
      }
    },
    update: (_table: unknown) => {
      state.updateCount++
      return {
        set: (values: unknown) => {
          state.updated.push(values)
          return chain([])
        },
      }
    },
    delete: (_table: unknown) => {
      state.deleteCount++
      return chain([])
    },
    execute: async () => [],
    // Transactions run their callback against the same mock, so writes inside
    // a transaction land in the same recorded arrays.
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  }

  return {
    db,
    queueSelect(rows) {
      selectQueue.push(rows)
    },
    setSelectRows(rows) {
      selectRows = rows
    },
    setReturningRows(rows) {
      returningRows = rows
    },
    queueReturning(rows) {
      returningQueue.push(rows)
    },
    get inserted() {
      return state.inserted
    },
    get updated() {
      return state.updated
    },
    get conflictUpdates() {
      return state.conflictUpdates
    },
    get deleteCount() {
      return state.deleteCount
    },
    get selectCount() {
      return state.selectCount
    },
    get insertCount() {
      return state.insertCount
    },
    get updateCount() {
      return state.updateCount
    },
    reset() {
      selectQueue = []
      selectRows = []
      returningQueue = []
      returningRows = []
      state.inserted.length = 0
      state.updated.length = 0
      state.conflictUpdates.length = 0
      state.deleteCount = 0
      state.selectCount = 0
      state.insertCount = 0
      state.updateCount = 0
    },
  }
}
