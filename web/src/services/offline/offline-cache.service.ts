import { api } from '@/lib/api'
import { OFFLINE_CACHE, offlineCacheKey, SIZE_HEADER, savedSize, toSavedResponse } from '@/lib/offline/offline-cache'
import { regionUrls } from '@/lib/offline/region-plan'
import { packageUrl } from '@/lib/offline/packages'
import type { OfflinePackageKind } from '@/types/offline-package.types'
import type { Bounds, OfflinePackageRef, OfflineRegion } from '@/types/offline.types'

const CONCURRENCY = 6
const PROGRESS_INTERVAL_MS = 250

export interface DownloadProgress {
  saved: number
  failed: number
  bytes: number
}

type RegionUrls = Pick<OfflineRegion, 'bounds' | 'sources' | 'files' | 'packages'>

/** Building a large region's timetable takes the server a while. */
const PACKAGE_TIMEOUT_MS = 240_000

export const isOfflineStorageSupported = () => typeof caches !== 'undefined'

async function saveOne(cache: Cache, url: string, refresh: boolean, signal: AbortSignal): Promise<number | null> {
  const key = offlineCacheKey(url)
  if (!refresh) {
    const hit = await cache.match(key)
    if (hit) return savedSize(hit)
  }
  try {
    const saved = await toSavedResponse(await fetch(url, { signal }))
    if (!saved) return null
    await cache.put(key, saved)
    return savedSize(saved)
  } catch (error) {
    if (signal.aborted) throw error
    return null
  }
}

/** Packages need the user's session, so they go through the API client rather than a bare fetch. */
async function savePackage(cache: Cache, ref: OfflinePackageRef, refresh: boolean, signal: AbortSignal): Promise<number | null> {
  const key = offlineCacheKey(ref.url)
  if (!refresh) {
    const hit = await cache.match(key)
    if (hit) return savedSize(hit)
  }
  try {
    const { data } = await api.get<string>(ref.url, { responseType: 'text', timeout: PACKAGE_TIMEOUT_MS, signal })
    const bytes = new TextEncoder().encode(data)
    await cache.put(key, new Response(bytes, {
      headers: { 'content-type': 'application/json', [SIZE_HEADER]: String(bytes.byteLength) },
    }))
    return bytes.byteLength
  } catch (error) {
    if (signal.aborted) throw error
    return null
  }
}

/**
 * Save every file and tile a region needs. Already-saved entries are kept
 * unless `refresh`, so calling this again resumes an interrupted download.
 */
export async function downloadRegion(
  region: RegionUrls,
  opts: { signal: AbortSignal; refresh?: boolean; onProgress: (p: DownloadProgress) => void },
): Promise<DownloadProgress> {
  const cache = await caches.open(OFFLINE_CACHE)
  const urls = regionUrls(region)
  const progress: DownloadProgress = { saved: 0, failed: 0, bytes: 0 }
  let lastReport = 0

  const report = (force = false) => {
    const now = performance.now()
    if (!force && now - lastReport < PROGRESS_INTERVAL_MS) return
    lastReport = now
    opts.onProgress({ ...progress })
  }

  async function worker() {
    for (let next = urls.next(); !next.done; next = urls.next()) {
      opts.signal.throwIfAborted()
      const size = await saveOne(cache, next.value, !!opts.refresh, opts.signal)
      if (size === null) progress.failed++
      else {
        progress.saved++
        progress.bytes += size
      }
      report()
    }
  }

  const packages = (async () => {
    for (const ref of region.packages ?? []) {
      const size = await savePackage(cache, ref, !!opts.refresh, opts.signal)
      if (size === null) progress.failed++
      else {
        progress.saved++
        progress.bytes += size
      }
      report()
    }
  })()

  await Promise.all([packages, ...Array.from({ length: CONCURRENCY - 1 }, worker)])
  report(true)
  return progress
}

export function packageRefs(kinds: readonly OfflinePackageKind[], bounds: Bounds): OfflinePackageRef[] {
  return kinds.map(kind => ({ kind, url: packageUrl(api.defaults.baseURL ?? '', kind, bounds) }))
}

/** Fetch one package again, for a timetable about to run out. */
export async function refreshPackage(ref: OfflinePackageRef, signal: AbortSignal): Promise<boolean> {
  const cache = await caches.open(OFFLINE_CACHE)
  return (await savePackage(cache, ref, true, signal)) !== null
}



/** Drop every saved entry no remaining region needs. */
export async function pruneOfflineCache(regions: RegionUrls[]): Promise<void> {
  const keep = new Set<string>()
  for (const region of regions) {
    for (const url of regionUrls(region)) keep.add(offlineCacheKey(url))
    for (const ref of region.packages ?? []) keep.add(offlineCacheKey(ref.url))
  }
  const cache = await caches.open(OFFLINE_CACHE)
  for (const request of await cache.keys()) {
    if (!keep.has(request.url)) await cache.delete(request)
  }
}

/** Ask the browser not to clear saved regions when space runs low. */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  if (await navigator.storage.persisted()) return true
  return navigator.storage.persist()
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null
  const { usage = 0, quota = 0 } = await navigator.storage.estimate()
  return { usage, quota }
}
