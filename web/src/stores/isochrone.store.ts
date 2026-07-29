/**
 * Isochrone Store
 *
 * Owns the isochrone tool's inputs (origin, mode, reach, band count,
 * direction) and the contours Barrelman returns for them. The fetch lives here
 * rather than in the component so a slider drag can supersede its own in-flight
 * request instead of racing it.
 */

import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { api } from '@/lib/api'
import type { LngLat } from '@/types/map.types'
import type {
  IsochroneMode,
  IsochroneResponse,
} from '@server/types/isochrone.types'
import {
  contourDurations,
  toIsochroneBands,
  maxMinutesForMode,
  type IsochroneBand,
} from '@/lib/isochrone.utils'

/** Debounce on control changes, so dragging a slider fires one request. */
const REQUEST_DEBOUNCE_MS = 350

/**
 * Isochrones outrun the client's 15s default: a transit contour fans out to
 * hundreds of per-stop graph searches upstream. Sits just above the proxy's
 * own 60s upstream budget so a slow Barrelman surfaces as its 502 rather than
 * as a client-side timeout that says nothing about what went wrong.
 */
const REQUEST_TIMEOUT_MS = 65_000

export type IsochroneStatus = 'empty' | 'loading' | 'ready' | 'error'

export const useIsochroneStore = defineStore('isochrone', () => {
  const origin = ref<LngLat | null>(null)
  const mode = ref<IsochroneMode>('walk')
  /** Reach of the outermost contour, in minutes. */
  const maxMinutes = ref(15)
  /** How many nested contours to draw. */
  const bandCount = ref(3)
  /** Reverse isochrone — the area that can *reach* the origin. */
  const arriveBy = ref(false)

  const bands = ref<IsochroneBand[]>([])
  const meta = ref<IsochroneResponse['meta'] | null>(null)
  const status = ref<IsochroneStatus>('empty')
  const error = ref<string | null>(null)

  const durations = computed(() =>
    contourDurations(maxMinutes.value, bandCount.value),
  )

  /** Guards against a slow early request overwriting a fast later one. */
  let requestId = 0
  let controller: AbortController | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  function cancelPending() {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    controller?.abort()
    controller = null
  }

  function setOrigin(next: LngLat | null) {
    origin.value = next
    if (!next) {
      cancelPending()
      requestId++
      bands.value = []
      meta.value = null
      status.value = 'empty'
      error.value = null
      return
    }
    void request()
  }

  function setMode(next: IsochroneMode) {
    mode.value = next
    // Transit's API ceiling (2h) sits below the street one (3h), so switching
    // into it can leave the reach above what Barrelman will accept. The tool's
    // own ceiling is currently below both, which makes this a no-op today —
    // it's here so raising that ceiling can't quietly start 400ing on transit.
    maxMinutes.value = Math.min(maxMinutes.value, maxMinutesForMode(next))
    scheduleRequest()
  }

  function setMaxMinutes(next: number) {
    maxMinutes.value = Math.min(next, maxMinutesForMode(mode.value))
    scheduleRequest()
  }

  function setBandCount(next: number) {
    bandCount.value = next
    scheduleRequest()
  }

  function setArriveBy(next: boolean) {
    arriveBy.value = next
    scheduleRequest()
  }

  /** Coalesce rapid control changes (a slider drag) into a single request. */
  function scheduleRequest() {
    if (!origin.value) return
    if (debounceTimer) clearTimeout(debounceTimer)
    // Show the pending state immediately — the contours on screen no longer
    // match the controls, and a silent delay reads as an unresponsive tool.
    status.value = 'loading'
    error.value = null
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      void request()
    }, REQUEST_DEBOUNCE_MS)
  }

  async function request() {
    const point = origin.value
    if (!point) return

    cancelPending()
    const id = ++requestId
    controller = new AbortController()
    status.value = 'loading'
    error.value = null

    try {
      const { data } = await api.get<IsochroneResponse>('/proxy/isochrone', {
        params: {
          lat: point.lat,
          lng: point.lng,
          mode: mode.value,
          durations: durations.value.join(','),
          arriveBy: arriveBy.value || undefined,
        },
        signal: controller.signal,
        timeout: REQUEST_TIMEOUT_MS,
        // The panel reports failures inline, next to the controls that caused
        // them; the global toast would just say the same thing twice.
        silent: true,
      } as any)
      if (id !== requestId) return

      bands.value = toIsochroneBands(data.isochrones?.features ?? [])
      meta.value = data.meta ?? null
      status.value = bands.value.length ? 'ready' : 'error'
      if (!bands.value.length) error.value = 'unreachable'
    } catch (err) {
      if (id !== requestId || isAbort(err)) return
      bands.value = []
      meta.value = null
      status.value = 'error'
      error.value = messageFor(err)
    } finally {
      if (id === requestId) controller = null
    }
  }

  /** Re-run the current request — used by the panel's retry affordance. */
  function retry() {
    if (origin.value) void request()
  }

  function clear() {
    cancelPending()
    requestId++
    origin.value = null
    bands.value = []
    meta.value = null
    status.value = 'empty'
    error.value = null
  }

  return {
    origin,
    mode,
    maxMinutes,
    bandCount,
    arriveBy,
    bands,
    meta,
    status,
    error,
    durations,
    setOrigin,
    setMode,
    setMaxMinutes,
    setBandCount,
    setArriveBy,
    retry,
    clear,
  }
})

function isAbort(err: unknown): boolean {
  const code = (err as { code?: string; name?: string } | null)?.code
  const name = (err as { name?: string } | null)?.name
  return (
    code === 'ERR_CANCELED' || name === 'CanceledError' || name === 'AbortError'
  )
}

/**
 * Barrelman's 4xx bodies name the offending parameter and its limit, and the
 * proxy forwards them intact — so prefer that message over a generic one.
 */
function messageFor(err: unknown): string {
  const body = (err as { response?: { data?: { error?: string } } } | null)
    ?.response?.data
  return body?.error || (err instanceof Error ? err.message : 'unknown')
}
