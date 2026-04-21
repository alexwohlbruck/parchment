/**
 * E2EE search history.
 *
 * Full history lives in client memory; an encrypted snapshot is flushed to
 * the server on debounce. Server-side is opaque — no typeahead runs there,
 * no analytics. FIFO-capped at MAX_ENTRIES so the blob stays bounded.
 *
 * Wire-up: the search UI calls `recordSearchEntry(text, userId)` after the
 * user commits a query; `getSearchHistory(userId)` hydrates on app boot.
 */

import { loadBlob, saveBlob } from './personal-blob'

const BLOB_TYPE = 'search-history'
const MAX_ENTRIES = 10_000
const DEBOUNCE_MS = 1500

export interface SearchHistoryEntry {
  query: string
  at: number // epoch ms
}

interface SearchHistoryBlob {
  version: 1
  entries: SearchHistoryEntry[]
}

let cache: SearchHistoryEntry[] | null = null
let loadedForUserId: string | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null
let pendingUserId: string | null = null

/**
 * Load the user's search history into memory, decrypting on the client.
 * Returns the in-memory array reference — caller should treat it as
 * read-only and use recordSearchEntry to mutate.
 */
export async function getSearchHistory(
  userId: string,
): Promise<SearchHistoryEntry[]> {
  if (cache && loadedForUserId === userId) return cache
  const blob = await loadBlob<SearchHistoryBlob>(BLOB_TYPE, userId)
  cache = blob?.entries ?? []
  loadedForUserId = userId
  return cache
}

/**
 * Append a new entry. Dedupes consecutive identical queries. Schedules a
 * debounced flush to the server.
 */
export function recordSearchEntry(query: string, userId: string): void {
  const trimmed = query.trim()
  if (!trimmed) return

  if (!cache || loadedForUserId !== userId) {
    // Not yet hydrated for this user — best-effort, but don't drop.
    cache = cache && loadedForUserId === userId ? cache : []
    loadedForUserId = userId
  }

  // Dedupe against the last entry — no point storing back-to-back dupes.
  const last = cache[cache.length - 1]
  if (last && last.query === trimmed) {
    last.at = Date.now()
  } else {
    cache.push({ query: trimmed, at: Date.now() })
  }

  // FIFO eviction.
  if (cache.length > MAX_ENTRIES) {
    cache.splice(0, cache.length - MAX_ENTRIES)
  }

  scheduleFlush(userId)
}

function scheduleFlush(userId: string) {
  pendingUserId = userId
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushNow()
  }, DEBOUNCE_MS)
}

/**
 * Force-flush any pending changes to the server. Safe to call from
 * beforeunload handlers.
 */
export async function flushNow(): Promise<void> {
  if (!cache || !pendingUserId) return
  const userId = pendingUserId
  pendingUserId = null
  try {
    await saveBlob<SearchHistoryBlob>(BLOB_TYPE, userId, {
      version: 1,
      entries: cache,
    })
  } catch (err) {
    console.warn('[search-history] flush failed, will retry on next record:', err)
    // Re-arm pending so the next record triggers a retry.
    pendingUserId = userId
  }
}

/**
 * Clear the history both locally and on the server. Used for "delete my
 * search history" UI.
 */
export async function clearSearchHistory(userId: string): Promise<void> {
  cache = []
  loadedForUserId = userId
  await saveBlob<SearchHistoryBlob>(BLOB_TYPE, userId, {
    version: 1,
    entries: [],
  })
}

export const searchHistoryInternals = {
  resetForTest: () => {
    cache = null
    loadedForUserId = null
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    pendingUserId = null
  },
  getCache: () => cache,
}

export const SEARCH_HISTORY_MAX_ENTRIES = MAX_ENTRIES
