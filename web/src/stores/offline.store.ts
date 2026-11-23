import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useEventListener, useStorage } from '@vueuse/core'
import { isOffline, onReconnected } from '@/lib/connectivity'
import { planRegion } from '@/lib/offline/region-plan'
import { TIMETABLE_REFRESH_MS } from '@/lib/offline/packages'
import { isExpired } from '@/lib/offline/expiry'
import {
  downloadRegion,
  isOfflineStorageSupported,
  packageRefs,
  pruneOfflineCache,
  refreshPackage,
  requestPersistentStorage,
  storageEstimate,
} from '@/services/offline/offline-cache.service'
import { setOfflineRegions } from '@/services/offline/offline-engine.service'
import type { OfflinePackageKind } from '@/types/offline-package.types'
import type { Bounds, OfflineLayerOption, OfflineRegion } from '@/types/offline.types'

/** The server builds a timetable for this many days from the day it is fetched. */
const TIMETABLE_DAYS = 14

const timetableDates = (savedAt: Date) => ({
  timetableSavedAt: savedAt.toISOString(),
  timetableUntil: new Date(savedAt.getTime() + (TIMETABLE_DAYS - 1) * 86_400_000).toISOString().slice(0, 10),
})

export const useOfflineStore = defineStore('offline', () => {
  const regions = useStorage<OfflineRegion[]>('parchment-offline-regions', [])
  const usage = ref<{ usage: number; quota: number } | null>(null)
  const persisted = ref(false)
  const supported = isOfflineStorageSupported()

  const downloads = new Map<string, AbortController>()
  const pausedByUser = new Set<string>()

  const sortedRegions = computed(() =>
    regions.value.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  )

  const find = (id: string) => regions.value.find(r => r.id === id)

  function patch(id: string, changes: Partial<OfflineRegion>) {
    const region = find(id)
    if (region) Object.assign(region, changes)
  }

  async function refreshUsage() {
    usage.value = await storageEstimate()
  }

  async function run(id: string, refresh = false) {
    const region = find(id)
    if (!region) return
    downloads.get(id)?.abort()
    const controller = new AbortController()
    downloads.set(id, controller)
    patch(id, { status: 'downloading', saved: 0, failed: 0, bytes: 0 })

    try {
      const result = await downloadRegion(region, {
        signal: controller.signal,
        refresh,
        onProgress: p => patch(id, p),
      })
      const now = new Date()
      patch(id, {
        ...result,
        status: result.failed ? 'failed' : 'ready',
        updatedAt: now.toISOString(),
        ...(region.packages?.some(p => p.kind === 'timetable') && timetableDates(now)),
      })
    } catch {
      // A dropped connection leaves it 'downloading', so reconnecting resumes it.
      if (find(id) && pausedByUser.has(id)) patch(id, { status: 'paused' })
    } finally {
      pausedByUser.delete(id)
      if (downloads.get(id) === controller) downloads.delete(id)
      void refreshUsage()
    }
  }

  interface RegionInput {
    bounds: Bounds
    options: OfflineLayerOption[]
    packages: OfflinePackageKind[]
    keepUntil: string | null
  }

  function contents(input: RegionInput) {
    const plan = planRegion(input.bounds, input.options)
    const packages = packageRefs(input.packages, input.bounds)
    return {
      bounds: input.bounds,
      layers: input.options.map(o => ({ id: o.id, name: o.name })),
      sources: plan.sources,
      files: plan.files,
      packages,
      total: plan.total + packages.length,
    }
  }

  async function createRegion(input: RegionInput & { name: string }) {
    const now = new Date().toISOString()
    const region: OfflineRegion = {
      id: crypto.randomUUID(),
      name: input.name,
      ...contents(input),
      ...(input.keepUntil && { keepUntil: input.keepUntil }),
      status: 'downloading',
      saved: 0,
      failed: 0,
      bytes: 0,
      createdAt: now,
      updatedAt: now,
    }
    regions.value.push(region)
    persisted.value = await requestPersistentStorage()
    void run(region.id)
    return region
  }

  /** Saved files the new contents still use are kept, so only what changed downloads. */
  async function editRegion(id: string, input: RegionInput) {
    if (!find(id)) return
    downloads.get(id)?.abort()
    const next = contents(input)
    const keepsTimetable = next.packages.some(p => p.kind === 'timetable')
    patch(id, {
      ...next,
      ...(!keepsTimetable && { timetableUntil: undefined, timetableSavedAt: undefined }),
      status: 'downloading',
    })
    setKeepUntil(id, input.keepUntil)
    await pruneOfflineCache(regions.value)
    void run(id)
  }

  function pause(id: string) {
    pausedByUser.add(id)
    downloads.get(id)?.abort()
  }

  const resume = (id: string) => run(id)
  const update = (id: string) => run(id, true)

  function rename(id: string, name: string) {
    patch(id, { name })
  }

  function setKeepUntil(id: string, keepUntil: string | null) {
    const region = find(id)
    if (!region) return
    if (keepUntil) region.keepUntil = keepUntil
    else delete region.keepUntil
  }

  async function removeWhere(drop: (region: OfflineRegion) => boolean) {
    const dropped = regions.value.filter(drop)
    if (!dropped.length) return
    for (const region of dropped) downloads.get(region.id)?.abort()
    regions.value = regions.value.filter(r => !drop(r))
    await pruneOfflineCache(regions.value)
    await refreshUsage()
  }

  const remove = (id: string) => removeWhere(r => r.id === id)
  const removeExpired = () => removeWhere(r => isExpired(r.keepUntil))

  /** Fetch timetables again well before they run out, so offline departures stay current. */
  async function refreshTimetables() {
    for (const region of regions.value) {
      const ref = region.packages?.find(p => p.kind === 'timetable')
      const age = Date.now() - Date.parse(region.timetableSavedAt ?? region.updatedAt)
      if (!ref || region.status !== 'ready' || downloads.has(region.id) || age < TIMETABLE_REFRESH_MS) continue
      if (await refreshPackage(ref, new AbortController().signal)) patch(region.id, timetableDates(new Date()))
    }
  }

  /** Pick up downloads a reload or a dropped connection interrupted. */
  function resumeInterrupted() {
    if (!supported || isOffline.value) return
    for (const region of regions.value) {
      if (region.status === 'downloading' && !downloads.has(region.id)) void run(region.id)
    }
    void refreshTimetables()
  }

  void removeExpired()
  resumeInterrupted()
  onReconnected(resumeInterrupted)
  useEventListener(document, 'visibilitychange', () => document.visibilityState === 'visible' && void removeExpired())
  watch(
    () =>
      regions.value
        .filter(r => r.status === 'ready' && r.packages?.length)
        .map(r => ({
          id: r.id,
          savedAt: `${r.updatedAt}|${r.timetableSavedAt ?? ''}`,
          urls: Object.fromEntries(r.packages!.map(p => [p.kind, p.url])),
        })),
    setOfflineRegions,
    { immediate: true },
  )
  // Offline fetches fail fast; stop rather than mark every remaining tile failed.
  watch(isOffline, offline => {
    if (offline) for (const controller of downloads.values()) controller.abort()
  })

  return {
    regions: sortedRegions,
    usage,
    persisted,
    supported,
    refreshUsage,
    createRegion,
    editRegion,
    pause,
    resume,
    update,
    rename,
    setKeepUntil,
    remove,
  }
})
