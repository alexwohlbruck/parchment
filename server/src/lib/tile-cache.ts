/**
 * A bounded, in-process cache for proxied tiles.
 *
 * Tiles are the ideal thing to cache and the worst thing to forward: a
 * single pan of the transit map asks for tiles from every mounted feed,
 * the same tiles come back on the next pan, and nothing about them
 * changes between rebuilds. Forwarding each one to barrelman cost a round
 * trip per tile and — because parchment proxies, so every user's traffic
 * arrives there from one address — ran the whole map into barrelman's
 * per-address rate limit. Normal viewing produced a steady stream of 429s.
 *
 * MISSES ARE CACHED TOO, and matter more than hits. The cutter only writes
 * tiles a feature touches, so most of a viewport is empty: a 60-tile burst
 * over New York returned 13 tiles and 47 empties. An empty answer that
 * costs a round trip is the expensive kind of nothing.
 *
 * Bounded by BYTES, not entries, because tiles differ by two orders of
 * magnitude (an empty answer is 0; a dense downtown tile is tens of KB) and
 * a count-based bound would either waste the budget or blow it. Eviction is
 * least-recently-used: a Map keeps insertion order, and re-inserting on
 * read moves an entry to the young end.
 *
 * In-process on purpose. Parchment runs one server container, so a shared
 * cache would add a network hop and a dependency to buy nothing. If it ever
 * runs horizontally — the same condition under which the rate limiter has
 * to become Redis-backed — this interface is what a shared implementation
 * replaces: get, set, and a byte budget.
 */

export interface CachedResponse {
  status: number
  /** null for a bodyless answer (204). ArrayBuffer rather than a view:
   *  it is what `new Response()` accepts without a cast. */
  body: ArrayBuffer | null
  contentType: string | null
}

interface Entry extends CachedResponse {
  /** Wall-clock ms when this stops being served. */
  expiresAt: number
  bytes: number
}

/** What an entry costs beyond its body: key, headers, object overhead. A
 *  rough constant is enough — it stops thousands of empty answers from
 *  looking free and overrunning the budget. */
const ENTRY_OVERHEAD_BYTES = 256

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export class TileCache {
  private readonly entries = new Map<string, Entry>()
  private bytes = 0
  private hits = 0
  private misses = 0
  private evictions = 0

  constructor(
    private readonly maxBytes: number,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get size(): number {
    return this.entries.size
  }

  get byteSize(): number {
    return this.bytes
  }

  stats() {
    return {
      entries: this.entries.size,
      bytes: this.bytes,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
    }
  }

  get(key: string): CachedResponse | null {
    const hit = this.entries.get(key)
    if (!hit) {
      this.misses++
      return null
    }
    if (hit.expiresAt <= this.now()) {
      // expired entries are dropped on sight rather than swept: the only
      // thing that can surface one is a read, and a read can pay for it
      this.entries.delete(key)
      this.bytes -= hit.bytes
      this.misses++
      return null
    }
    // re-insert to move it to the young end of the LRU order
    this.entries.delete(key)
    this.entries.set(key, hit)
    this.hits++
    return { status: hit.status, body: hit.body, contentType: hit.contentType }
  }

  set(key: string, value: CachedResponse): void {
    const bytes = (value.body?.byteLength ?? 0) + ENTRY_OVERHEAD_BYTES
    // A single entry larger than the whole budget is not cacheable; storing
    // it would evict everything else to hold one tile.
    if (bytes > this.maxBytes) return

    const existing = this.entries.get(key)
    if (existing) {
      this.entries.delete(key)
      this.bytes -= existing.bytes
    }
    this.entries.set(key, { ...value, bytes, expiresAt: this.now() + this.ttlMs })
    this.bytes += bytes

    while (this.bytes > this.maxBytes) {
      const oldest = this.entries.keys().next()
      if (oldest.done) break
      const victim = this.entries.get(oldest.value)!
      this.entries.delete(oldest.value)
      this.bytes -= victim.bytes
      this.evictions++
    }
  }

  clear(): void {
    this.entries.clear()
    this.bytes = 0
  }
}

/**
 * The proxy's cache.
 *
 * The TTL matches the `max-age` tiles already carry, so the server holds
 * them exactly as long as it tells browsers to — a retile is visible to a
 * cold client and a warm one at the same time, rather than the server
 * being the staler of the two.
 */
export const portolanTileCache = new TileCache(
  envNumber('PORTOLAN_TILE_CACHE_MB', 256) * 1024 * 1024,
  envNumber('PORTOLAN_TILE_CACHE_TTL_S', 3600) * 1000,
)
