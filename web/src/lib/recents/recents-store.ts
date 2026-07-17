/**
 * Generic E2EE "recents" store.
 *
 * A recents *kind* is an ordered, de-duplicated, size-capped list of small
 * JSON items — recent searches, recently-viewed places, and whatever we add
 * next. Each kind syncs to the server as a single encrypted personal blob, so
 * the server only ever sees ciphertext (see `personal-blob.ts` / the
 * `encrypted_user_blobs` table).
 *
 * Adding a new recents type = one more `createRecentsStore(...)` instance with
 * its own `blobType`. Encryption, persistence, dedupe, capping, and K_m
 * rotation participation are all inherited — rotation enumerates every blob
 * type generically, so a new kind is picked up with no extra wiring.
 *
 * Storage model mirrors the personal-blob contract: the whole list is
 * re-uploaded (debounced) on every change, so we merge + cap in memory before
 * writing. Entries are kept oldest→newest internally; `list()` and `hydrate()`
 * return them newest-first for display.
 */

import { loadBlob, saveBlob } from '../personal-blob'

export interface RecentsStoreConfig<T> {
  /**
   * Personal-blob type string; also the AEAD `recordId`. Must be unique per
   * kind so cross-type ciphertext confusion fails AEAD. Matches the server's
   * `^[a-zA-Z0-9._:-]{1,64}$` allowlist.
   */
  blobType: string
  /** Max entries retained; the oldest are evicted first. */
  maxEntries: number
  /**
   * Stable identity used to de-duplicate. Recording an item whose identity
   * matches an existing entry drops the old one and appends the new (moves it
   * to most-recent), so a kind never shows the same thing twice.
   */
  identityOf: (item: T) => string
  /** Debounce before flushing to the server. Defaults to 1500ms. */
  debounceMs?: number
}

/** On-the-wire (pre-encryption) payload for a recents blob. */
interface RecentsBlob<T> {
  version: 1
  entries: T[] // oldest → newest
}

export interface RecentsStore<T> {
  /** Load + decrypt from the server (merging any pre-hydrate local writes). Returns newest-first. */
  hydrate(userId: string): Promise<T[]>
  /** Append an item (move-to-front on identity match) and schedule a flush. */
  record(item: T, userId: string): void
  /** Current in-memory snapshot, newest-first. */
  list(): T[]
  /** Wipe locally and on the server. */
  clear(userId: string): Promise<void>
  /** Force any pending flush now (e.g. from a beforeunload handler). */
  flush(): Promise<void>
  /** Test hook — resets all module-level state. */
  _resetForTest(): void
}

export function createRecentsStore<T>(
  config: RecentsStoreConfig<T>,
): RecentsStore<T> {
  const debounceMs = config.debounceMs ?? 1500

  let cache: T[] | null = null // oldest → newest
  let loadedForUserId: string | null = null
  let hydratedFromServer = false
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let pendingUserId: string | null = null

  const idOf = (item: T) => config.identityOf(item)

  /**
   * Keep the LAST occurrence of each identity, preserving the order those last
   * occurrences appear in. Result stays oldest→newest with newer duplicates
   * winning both position and payload.
   */
  function dedupeByIdentity(entries: T[]): T[] {
    const lastPos = new Map<string, number>()
    entries.forEach((e, i) => lastPos.set(idOf(e), i))
    return entries.filter((_, i) => lastPos.get(idOf(entries[i])) === i)
  }

  function cap(entries: T[]): T[] {
    return entries.length > config.maxEntries
      ? entries.slice(entries.length - config.maxEntries)
      : entries
  }

  function snapshot(): T[] {
    return cache ? [...cache].reverse() : []
  }

  async function hydrate(userId: string): Promise<T[]> {
    if (hydratedFromServer && loadedForUserId === userId) return snapshot()

    const blob = await loadBlob<RecentsBlob<T>>(config.blobType, userId)
    const loaded = blob?.entries ?? []
    // Merge server entries with anything recorded locally before this first
    // server hydrate, so a view logged pre-hydrate isn't dropped. Local entries
    // are newer, so they win position + payload on an identity collision.
    const local = loadedForUserId === userId && cache ? cache : []
    cache = cap(dedupeByIdentity([...loaded, ...local]))
    loadedForUserId = userId
    hydratedFromServer = true
    return snapshot()
  }

  function record(item: T, userId: string): void {
    if (loadedForUserId !== userId) {
      // Switched users (or first touch) — start fresh; a later hydrate for this
      // user will merge in whatever the server holds.
      cache = []
      loadedForUserId = userId
      hydratedFromServer = false
    } else if (!cache) {
      cache = []
    }

    const id = idOf(item)
    const existing = cache.findIndex(e => idOf(e) === id)
    if (existing !== -1) cache.splice(existing, 1)
    cache.push(item)
    cache = cap(cache)

    scheduleFlush(userId)
  }

  function scheduleFlush(userId: string) {
    pendingUserId = userId
    if (flushTimer) clearTimeout(flushTimer)
    flushTimer = setTimeout(() => {
      flushTimer = null
      void flush()
    }, debounceMs)
  }

  async function flush(): Promise<void> {
    if (!cache || !pendingUserId) return
    const userId = pendingUserId
    pendingUserId = null
    try {
      await saveBlob<RecentsBlob<T>>(config.blobType, userId, {
        version: 1,
        entries: cache,
      })
    } catch (err) {
      console.warn(
        `[recents:${config.blobType}] flush failed, will retry on next record:`,
        err,
      )
      // Re-arm so the next record (or explicit flush) retries.
      pendingUserId = userId
    }
  }

  async function clear(userId: string): Promise<void> {
    cache = []
    loadedForUserId = userId
    hydratedFromServer = true
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    pendingUserId = null
    await saveBlob<RecentsBlob<T>>(config.blobType, userId, {
      version: 1,
      entries: [],
    })
  }

  function _resetForTest() {
    cache = null
    loadedForUserId = null
    hydratedFromServer = false
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    pendingUserId = null
  }

  return { hydrate, record, list: snapshot, clear, flush, _resetForTest }
}
