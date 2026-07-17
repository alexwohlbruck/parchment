/**
 * Tests for the generic in-memory + encrypted-blob recents core.
 *
 * We mock loadBlob/saveBlob from ../personal-blob to keep tests focused on
 * caching, dedupe, FIFO, merge-on-hydrate, and flush scheduling. The
 * encryption path itself is covered in crypto-envelope.test.ts.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRecentsStore } from './recents-store'

let savedBlobs: Record<string, any[]> = {}
let loadedValue: any = null

vi.mock('../personal-blob', () => ({
  loadBlob: vi.fn(async () => loadedValue),
  saveBlob: vi.fn(async (_type: string, userId: string, value: any) => {
    savedBlobs[userId] = (savedBlobs[userId] ?? []).concat(value)
  }),
  deleteBlob: vi.fn(async () => {}),
}))

interface Entry {
  query: string
  at: number
}

function makeStore(maxEntries = 100) {
  return createRecentsStore<Entry>({
    blobType: 'test-kind',
    maxEntries,
    identityOf: e => e.query.trim().toLowerCase(),
    debounceMs: 1500,
  })
}

beforeEach(() => {
  savedBlobs = {}
  loadedValue = null
  vi.clearAllMocks()
})

describe('recents-store', () => {
  test('hydrate returns empty array when no blob exists', async () => {
    const store = makeStore()
    expect(await store.hydrate('u1')).toEqual([])
  })

  test('hydrate returns decrypted entries newest-first', async () => {
    loadedValue = {
      version: 1,
      entries: [
        { query: 'older', at: 1 },
        { query: 'newer', at: 2 },
      ],
    }
    const store = makeStore()
    const list = await store.hydrate('u1')
    expect(list.map(e => e.query)).toEqual(['newer', 'older'])
  })

  test('record appends and list is newest-first', async () => {
    const store = makeStore()
    await store.hydrate('u1')
    store.record({ query: 'pizza', at: 1 }, 'u1')
    store.record({ query: 'sushi', at: 2 }, 'u1')
    expect(store.list().map(e => e.query)).toEqual(['sushi', 'pizza'])
  })

  test('move-to-front dedupe on identity match', async () => {
    const store = makeStore()
    await store.hydrate('u1')
    store.record({ query: 'pizza', at: 1 }, 'u1')
    store.record({ query: 'sushi', at: 2 }, 'u1')
    store.record({ query: 'PIZZA', at: 3 }, 'u1') // same identity as 'pizza'
    const list = store.list()
    expect(list.map(e => e.query)).toEqual(['PIZZA', 'sushi'])
    expect(list).toHaveLength(2)
  })

  test('FIFO evicts when over maxEntries', async () => {
    const store = makeStore(3)
    await store.hydrate('u1')
    for (let i = 0; i < 5; i++) store.record({ query: `q${i}`, at: i }, 'u1')
    // Kept newest 3, oldest (q0, q1) evicted.
    expect(store.list().map(e => e.query)).toEqual(['q4', 'q3', 'q2'])
  })

  test('flush persists cache oldest-first as a blob', async () => {
    const store = makeStore()
    await store.hydrate('u1')
    store.record({ query: 'tacos', at: 1 }, 'u1')
    store.record({ query: 'ramen', at: 2 }, 'u1')
    await store.flush()

    expect(savedBlobs.u1).toHaveLength(1)
    expect(savedBlobs.u1[0].entries.map((e: Entry) => e.query)).toEqual([
      'tacos',
      'ramen',
    ])
  })

  test('clear wipes cache and pushes an empty blob', async () => {
    const store = makeStore()
    await store.hydrate('u1')
    store.record({ query: 'sensitive', at: 1 }, 'u1')
    await store.clear('u1')

    expect(store.list()).toEqual([])
    const last = savedBlobs.u1[savedBlobs.u1.length - 1]
    expect(last.entries).toEqual([])
  })

  test('hydrate reloads when the userId changes', async () => {
    loadedValue = { version: 1, entries: [{ query: 'u1-entry', at: 1 }] }
    const store = makeStore()
    expect((await store.hydrate('u1'))[0].query).toBe('u1-entry')

    loadedValue = { version: 1, entries: [{ query: 'u2-entry', at: 2 }] }
    expect((await store.hydrate('u2'))[0].query).toBe('u2-entry')
  })

  test('records logged before hydrate are merged with server entries', async () => {
    const store = makeStore()
    // View logged before we ever hit the server for this user.
    store.record({ query: 'local', at: 10 }, 'u1')

    // Now the server responds with a prior history.
    loadedValue = {
      version: 1,
      entries: [
        { query: 'server-a', at: 1 },
        { query: 'server-b', at: 2 },
      ],
    }
    const list = await store.hydrate('u1')
    // Server entries oldest→newest, then the pre-hydrate local write on top.
    expect(list.map(e => e.query)).toEqual(['local', 'server-b', 'server-a'])
  })

  test('local write wins over a server duplicate on merge', async () => {
    const store = makeStore()
    store.record({ query: 'coffee', at: 99 }, 'u1')
    loadedValue = {
      version: 1,
      entries: [
        { query: 'coffee', at: 1 },
        { query: 'tea', at: 2 },
      ],
    }
    const list = await store.hydrate('u1')
    expect(list.map(e => e.query)).toEqual(['coffee', 'tea'])
    expect(list.find(e => e.query === 'coffee')?.at).toBe(99)
  })

  test('trims are the caller’s job — identity normalises case/space', async () => {
    const store = makeStore()
    await store.hydrate('u1')
    store.record({ query: 'Hello', at: 1 }, 'u1')
    store.record({ query: ' hello ', at: 2 }, 'u1')
    expect(store.list()).toHaveLength(1)
  })

  test('a kind-aware identity keeps text and category entries distinct', async () => {
    // Mirrors the real recentSearches identityOf: a typed "cafe" and the
    // "Cafe" category must both survive rather than de-duping into one.
    interface Search {
      query: string
      at: number
      kind?: 'text' | 'category'
      categoryId?: string
    }
    const store = createRecentsStore<Search>({
      blobType: 'searches',
      maxEntries: 100,
      identityOf: e =>
        e.kind === 'category' && e.categoryId
          ? `category:${e.categoryId}`
          : `text:${e.query.trim().toLowerCase()}`,
    })
    await store.hydrate('u1')
    store.record({ query: 'cafe', kind: 'text', at: 1 }, 'u1')
    store.record(
      { query: 'Cafe', kind: 'category', categoryId: 'amenity/cafe', at: 2 },
      'u1',
    )
    store.record({ query: 'cafe', kind: 'text', at: 3 }, 'u1') // dedupes with #1
    const list = store.list()
    expect(list).toHaveLength(2)
    expect(list.map(e => e.kind)).toEqual(['text', 'category'])
  })
})

describe('recents-store debounced flush', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  test('record schedules a debounced flush', async () => {
    const store = makeStore()
    // hydrate awaits a mocked promise; run microtasks so it resolves.
    const hydrated = store.hydrate('u1')
    await vi.runAllTicks?.()
    await hydrated
    store.record({ query: 'burgers', at: 1 }, 'u1')
    expect(savedBlobs.u1).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1500)
    expect(savedBlobs.u1?.[0].entries[0].query).toBe('burgers')
  })
})
