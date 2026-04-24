/**
 * Tests for the in-memory + encrypted-blob search history.
 *
 * We mock loadBlob/saveBlob from ./personal-blob to keep tests focused on
 * the caching, dedup, FIFO, and flush-scheduling logic. The encryption
 * path is covered separately in crypto-envelope.test.ts and
 * metadata-crypto.test.ts.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest'

let savedBlobs: Record<string, unknown[]> = {}
let loadedValue: unknown = null

vi.mock('./personal-blob', () => ({
  loadBlob: vi.fn(async () => loadedValue),
  saveBlob: vi.fn(async (_type: string, userId: string, value: any) => {
    savedBlobs[userId] = (savedBlobs[userId] ?? []).concat(value)
  }),
  deleteBlob: vi.fn(async () => {}),
}))

import {
  getSearchHistory,
  recordSearchEntry,
  flushNow,
  clearSearchHistory,
  searchHistoryInternals,
  SEARCH_HISTORY_MAX_ENTRIES,
} from './search-history'

beforeEach(() => {
  searchHistoryInternals.resetForTest()
  savedBlobs = {}
  loadedValue = null
  vi.clearAllMocks()
})

describe('search-history', () => {
  test('getSearchHistory returns empty array when no blob exists', async () => {
    loadedValue = null
    const h = await getSearchHistory('u1')
    expect(h).toEqual([])
  })

  test('getSearchHistory returns decrypted entries from server', async () => {
    loadedValue = {
      version: 1,
      entries: [{ query: 'hello', at: 1 }],
    }
    const h = await getSearchHistory('u1')
    expect(h).toEqual([{ query: 'hello', at: 1 }])
  })

  test('recordSearchEntry appends to cache', async () => {
    await getSearchHistory('u1')
    recordSearchEntry('coffee shops', 'u1')
    const cache = searchHistoryInternals.getCache()
    expect(cache?.length).toBe(1)
    expect(cache?.[0].query).toBe('coffee shops')
  })

  test('dedupes consecutive identical queries', async () => {
    await getSearchHistory('u1')
    recordSearchEntry('pizza', 'u1')
    recordSearchEntry('pizza', 'u1')
    recordSearchEntry('pizza', 'u1')
    const cache = searchHistoryInternals.getCache()
    expect(cache?.length).toBe(1)
  })

  test('different consecutive queries accumulate', async () => {
    await getSearchHistory('u1')
    recordSearchEntry('pizza', 'u1')
    recordSearchEntry('sushi', 'u1')
    recordSearchEntry('burgers', 'u1')
    const cache = searchHistoryInternals.getCache()
    expect(cache?.length).toBe(3)
  })

  test('trims whitespace and drops empty entries', async () => {
    await getSearchHistory('u1')
    recordSearchEntry('   ', 'u1')
    recordSearchEntry('  hello  ', 'u1')
    const cache = searchHistoryInternals.getCache()
    expect(cache?.length).toBe(1)
    expect(cache?.[0].query).toBe('hello')
  })

  test('FIFO evicts when over MAX_ENTRIES', async () => {
    // Exceed the cap directly via recordSearchEntry; MAX_ENTRIES is 10k
    // so loop to cap + 5 to prove eviction kicks in.
    await getSearchHistory('u1')
    for (let i = 0; i <= SEARCH_HISTORY_MAX_ENTRIES + 5; i++) {
      recordSearchEntry(`q${i}`, 'u1')
    }
    const cache = searchHistoryInternals.getCache()
    expect(cache?.length).toBe(SEARCH_HISTORY_MAX_ENTRIES)
    // Oldest entries dropped.
    expect(cache?.[0].query).toBe('q6')
  })

  test('flushNow persists current cache as a blob', async () => {
    await getSearchHistory('u1')
    recordSearchEntry('tacos', 'u1')
    await flushNow()

    expect(savedBlobs.u1).toBeDefined()
    expect(savedBlobs.u1.length).toBe(1)
    const payload = savedBlobs.u1[0] as { entries: { query: string }[] }
    expect(payload.entries[0].query).toBe('tacos')
  })

  test('clearSearchHistory wipes cache and pushes empty blob', async () => {
    await getSearchHistory('u1')
    recordSearchEntry('sensitive', 'u1')
    await clearSearchHistory('u1')

    expect(searchHistoryInternals.getCache()).toEqual([])
    const last = savedBlobs.u1?.[savedBlobs.u1.length - 1] as {
      entries: unknown[]
    }
    expect(last.entries).toEqual([])
  })

  test('reset reloads if userId changes', async () => {
    loadedValue = { version: 1, entries: [{ query: 'u1-entry', at: 1 }] }
    const h1 = await getSearchHistory('u1')
    expect(h1[0].query).toBe('u1-entry')

    searchHistoryInternals.resetForTest()
    loadedValue = { version: 1, entries: [{ query: 'u2-entry', at: 2 }] }
    const h2 = await getSearchHistory('u2')
    expect(h2[0].query).toBe('u2-entry')
  })
})
