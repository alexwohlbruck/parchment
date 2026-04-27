import { ref, computed, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import axios from 'axios'
import {
  fetchLocationHistory,
  MissingDawarichConfigError,
} from '@/services/timeline.service'
import type {
  LocationHistory,
  LocationHistoryEntry,
} from '@server/types/location-history.types'

export type TimelineRangeMode = 'day' | 'custom'

export interface TimelineRange {
  start: Date
  end: Date
  mode: TimelineRangeMode
}

const CACHE_LIMIT = 8
const cacheKey = (range: TimelineRange) =>
  `${range.start.toISOString()}|${range.end.toISOString()}`

function startOfLocalDay(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

function endOfLocalDay(d: Date): Date {
  const out = new Date(d)
  out.setHours(23, 59, 59, 999)
  return out
}

export function dayRange(d: Date): TimelineRange {
  return { start: startOfLocalDay(d), end: endOfLocalDay(d), mode: 'day' }
}

export const useTimelineStore = defineStore('timeline', () => {
  // ── State ─────────────────────────────────────────────────────────────────
  const range = ref<TimelineRange>(dayRange(new Date()))
  const data = shallowRef<LocationHistory | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  /**
   * LRU-ish cache keyed by ISO range. Bounded to avoid unbounded memory when
   * users skim through many days.
   */
  const cache = new Map<string, LocationHistory>()
  let activeController: AbortController | null = null

  // ── Computed ──────────────────────────────────────────────────────────────
  const entries = computed<LocationHistoryEntry[]>(
    () => data.value?.entries ?? [],
  )
  const dailyStats = computed(() => data.value?.dailyStats ?? [])
  const stops = computed(() =>
    entries.value.filter(
      (e): e is Extract<LocationHistoryEntry, { type: 'stop' }> =>
        e.type === 'stop',
    ),
  )
  const segments = computed(() =>
    entries.value.filter(
      (e): e is Extract<LocationHistoryEntry, { type: 'segment' }> =>
        e.type === 'segment',
    ),
  )

  // ── Actions ───────────────────────────────────────────────────────────────
  function setRange(next: TimelineRange) {
    range.value = next
    void load()
  }

  function setDay(date: Date) {
    setRange(dayRange(date))
  }

  async function load(): Promise<void> {
    error.value = null

    const key = cacheKey(range.value)
    const cached = cache.get(key)
    if (cached) {
      data.value = cached
      // Refresh LRU position
      cache.delete(key)
      cache.set(key, cached)
      return
    }

    if (activeController) activeController.abort()
    activeController = new AbortController()
    const controller = activeController
    loading.value = true

    try {
      const result = await fetchLocationHistory({
        start: range.value.start,
        end: range.value.end,
        signal: controller.signal,
      })
      // Drop stale results if the range changed mid-flight
      if (controller !== activeController) return
      data.value = result
      cache.set(key, result)
      while (cache.size > CACHE_LIMIT) {
        const oldest = cache.keys().next().value
        if (oldest === undefined) break
        cache.delete(oldest)
      }
    } catch (err: unknown) {
      if (axios.isCancel(err)) return
      if (err instanceof MissingDawarichConfigError) {
        error.value = err.message
        data.value = null
        return
      }
      error.value =
        err instanceof Error ? err.message : 'Failed to load timeline'
      data.value = null
    } finally {
      if (controller === activeController) {
        loading.value = false
        activeController = null
      }
    }
  }

  function clear() {
    cache.clear()
    data.value = null
    error.value = null
    if (activeController) {
      activeController.abort()
      activeController = null
    }
  }

  return {
    range,
    data,
    entries,
    dailyStats,
    stops,
    segments,
    loading,
    error,
    setRange,
    setDay,
    load,
    clear,
  }
})
