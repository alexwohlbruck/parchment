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

export type TimelineRangeMode = 'day' | 'range'

export interface TimelineRange {
  start: Date
  end: Date
  mode: TimelineRangeMode
}

/** Days of context the chart shows around the selected day. */
const CHART_DAYS_BEFORE = 14
const CHART_DAYS_AFTER = 14
const CACHE_LIMIT = 8

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

function addDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

export function dayRange(d: Date): TimelineRange {
  return { start: startOfLocalDay(d), end: endOfLocalDay(d), mode: 'day' }
}

export function customRange(start: Date, end: Date): TimelineRange {
  return { start, end, mode: 'range' }
}

/**
 * Window the daily-distance chart covers. Always at least
 * `CHART_DAYS_BEFORE + CHART_DAYS_AFTER + 1` days centered on the entries
 * range — keeps surrounding-day context visible even when the user is
 * viewing a single day.
 */
function statsRangeFor(range: TimelineRange): { start: Date; end: Date } {
  const minSpanMs =
    (CHART_DAYS_BEFORE + CHART_DAYS_AFTER + 1) * 24 * 3600 * 1000
  const span = range.end.getTime() - range.start.getTime()
  if (span >= minSpanMs) return range
  const midMs = range.start.getTime() + span / 2
  const center = startOfLocalDay(new Date(midMs))
  return {
    start: addDays(center, -CHART_DAYS_BEFORE),
    end: endOfLocalDay(addDays(center, CHART_DAYS_AFTER)),
  }
}

const cacheKey = (range: TimelineRange) =>
  `${range.start.toISOString()}|${range.end.toISOString()}`

export const useTimelineStore = defineStore('timeline', () => {
  // ── State ─────────────────────────────────────────────────────────────────
  const range = ref<TimelineRange>(dayRange(new Date()))
  const data = shallowRef<LocationHistory | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

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
      cache.delete(key)
      cache.set(key, cached)
      return
    }

    if (activeController) activeController.abort()
    activeController = new AbortController()
    const controller = activeController
    loading.value = true

    try {
      const stats = statsRangeFor(range.value)
      const result = await fetchLocationHistory({
        start: range.value.start,
        end: range.value.end,
        statsStart: stats.start,
        statsEnd: stats.end,
        signal: controller.signal,
      })
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
