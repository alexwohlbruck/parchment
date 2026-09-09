/**
 * Generic versioned localStorage cache for server-fetched app data.
 *
 * Cache is invalidated when:
 *   - The schema version (schemaVersion) changes — bump when the data shape changes
 *   - The app version (__APP_VERSION__) changes — ensures fresh data after deploys
 *   - The entry is older than maxAgeHours
 *
 * Usage:
 *   const cache = useAppDataCache<MyData>('my-key', { schemaVersion: 1 })
 *   if (cache.isStale()) {
 *     const data = await fetchFromServer()
 *     cache.set(data)
 *   }
 *   return cache.get()
 */

declare const __APP_VERSION__: string

export interface AppDataCacheOptions {
  /** Increment when the cached data structure changes */
  schemaVersion: number
  /** How long before re-fetching from the server (default: 24 hours) */
  maxAgeHours?: number
}

interface CacheEntry<T> {
  data: T
  storedAt: string      // ISO timestamp
  schemaVersion: number
  appVersion: string
}

export function useAppDataCache<T>(storageKey: string, options: AppDataCacheOptions) {
  const { schemaVersion, maxAgeHours = 24 } = options

  function readRaw(): CacheEntry<T> | null {
    try {
      const raw = localStorage.getItem(storageKey)
      return raw ? (JSON.parse(raw) as CacheEntry<T>) : null
    } catch {
      return null
    }
  }

  function isStale(): boolean {
    const entry = readRaw()
    if (!entry) return true
    if (entry.schemaVersion !== schemaVersion) return true
    if (entry.appVersion !== __APP_VERSION__) return true

    const ageMs = Date.now() - new Date(entry.storedAt).getTime()
    if (ageMs > maxAgeHours * 60 * 60 * 1000) return true

    return false
  }

  function get(): T | null {
    return readRaw()?.data ?? null
  }

  function set(data: T): void {
    const entry: CacheEntry<T> = {
      data,
      storedAt: new Date().toISOString(),
      schemaVersion,
      appVersion: __APP_VERSION__,
    }
    localStorage.setItem(storageKey, JSON.stringify(entry))
  }

  function clear(): void {
    localStorage.removeItem(storageKey)
  }

  return { isStale, get, set, clear }
}
