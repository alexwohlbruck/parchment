/**
 * A bounded cache of in-flight and settled lookups, so concurrent and repeat
 * requests for one key share a single load. Evicts in insertion order.
 */
export class MemoCache<V> {
  private readonly entries = new Map<string, { at: number; value: Promise<V> }>()

  constructor(
    private readonly options: {
      max: number
      /** Reload entries older than this; omit to keep them until evicted. */
      ttlMs?: number
      /** Whether a resolved value is worth keeping. Rejections never are. */
      keep?: (value: V) => boolean
    },
  ) {}

  get(key: string, load: () => Promise<V>): Promise<V> {
    const hit = this.entries.get(key)
    const { ttlMs, max, keep } = this.options
    if (hit && (ttlMs == null || Date.now() - hit.at < ttlMs)) return hit.value

    const entry = { at: Date.now(), value: new Promise<V>((resolve) => resolve(load())) }
    this.entries.delete(key)
    this.entries.set(key, entry)
    if (this.entries.size > max) {
      const oldest = this.entries.keys().next().value
      if (oldest !== undefined) this.entries.delete(oldest)
    }

    const forget = () => {
      if (this.entries.get(key) === entry) this.entries.delete(key)
    }
    entry.value.then((value) => { if (keep && !keep(value)) forget() }, forget)
    return entry.value
  }
}
