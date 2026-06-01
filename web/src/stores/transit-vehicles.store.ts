/**
 * Transit Vehicles Store
 *
 * Polls GTFS-RT vehicle positions from Barrelman via the proxy
 * endpoint and exposes them as a reactive Map. The store owns the
 * polling lifecycle — start/stop are gated by the transit-vehicles
 * map layer visibility.
 */

import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { api } from '@/lib/api'
import type { TransitVehiclePosition } from '@/types/multimodal.types'

/** How often we poll Barrelman for fresh positions (ms). */
const POLL_INTERVAL_MS = 15_000

/** Drop vehicles whose last report is older than this (ms). */
const STALE_THRESHOLD_MS = 2 * 60 * 1000

/** Skip re-fetch if the viewport hasn't moved by more than this
 *  fraction of its span in either axis. */
const BOUNDS_MOVE_THRESHOLD = 0.1

interface Bounds {
  north: number
  south: number
  east: number
  west: number
}

function boundsSignificantlyChanged(
  a: Bounds | null,
  b: Bounds,
): boolean {
  if (!a) return true
  const latSpan = Math.abs(a.north - a.south)
  const lngSpan = Math.abs(a.east - a.west)
  if (latSpan === 0 || lngSpan === 0) return true
  return (
    Math.abs(a.north - b.north) / latSpan > BOUNDS_MOVE_THRESHOLD ||
    Math.abs(a.south - b.south) / latSpan > BOUNDS_MOVE_THRESHOLD ||
    Math.abs(a.east - b.east) / lngSpan > BOUNDS_MOVE_THRESHOLD ||
    Math.abs(a.west - b.west) / lngSpan > BOUNDS_MOVE_THRESHOLD
  )
}

/** Expand bounds by a fraction so vehicles near the viewport edge
 *  are prefetched before they become visible. */
function expandBounds(b: Bounds, fraction: number): Bounds {
  const latPad = (b.north - b.south) * fraction
  const lngPad = (b.east - b.west) * fraction
  return {
    north: b.north + latPad,
    south: b.south - latPad,
    east: b.east + lngPad,
    west: b.west - lngPad,
  }
}

export const useTransitVehiclesStore = defineStore(
  'transit-vehicles',
  () => {
    // ── State ──────────────────────────────────────────────────────────
    const vehicles = ref<Map<string, TransitVehiclePosition>>(new Map())
    const isPolling = ref(false)
    const lastFetchedBounds = ref<Bounds | null>(null)
    const lastFetchedAt = ref<number | null>(null)

    let pollTimer: ReturnType<typeof setInterval> | null = null
    let getBoundsFn: (() => Bounds | null) | null = null

    // ── Getters ────────────────────────────────────────────────────────
    const vehicleList = computed(() => Array.from(vehicles.value.values()))
    const count = computed(() => vehicles.value.size)

    // ── Actions ────────────────────────────────────────────────────────

    async function fetchVehicles(bounds: Bounds) {
      try {
        const expanded = expandBounds(bounds, 0.2)
        const { data } = await api.get<{
          vehicles: TransitVehiclePosition[]
          feedTimestamps?: Record<string, string>
        }>('/proxy/transit/vehicles', {
          params: {
            north: expanded.north,
            south: expanded.south,
            east: expanded.east,
            west: expanded.west,
          },
        })

        const now = Date.now()
        const incoming = new Map<string, TransitVehiclePosition>()

        for (const v of data.vehicles) {
          // Skip stale reports
          const age = now - new Date(v.timestamp).getTime()
          if (age > STALE_THRESHOLD_MS) continue
          incoming.set(v.vehicleId, v)
        }

        // Merge: keep vehicles from previous fetches that are still in
        // the expanded bounds and not stale (they may have left the
        // response because they moved slightly outside the new bbox).
        const merged = new Map<string, TransitVehiclePosition>()
        for (const [id, v] of incoming) {
          merged.set(id, v)
        }
        for (const [id, v] of vehicles.value) {
          if (merged.has(id)) continue
          const age = now - new Date(v.timestamp).getTime()
          if (age > STALE_THRESHOLD_MS) continue
          // Keep if still within expanded bounds
          if (
            v.position.lat >= expanded.south &&
            v.position.lat <= expanded.north &&
            v.position.lng >= expanded.west &&
            v.position.lng <= expanded.east
          ) {
            merged.set(id, v)
          }
        }

        vehicles.value = merged
        lastFetchedBounds.value = expanded
        lastFetchedAt.value = now
      } catch {
        // Silently ignore — Barrelman may not be configured or may
        // not support vehicle positions yet.
      }
    }

    function pollOnce() {
      if (!getBoundsFn) return
      const bounds = getBoundsFn()
      if (!bounds) return

      // Skip fetch if the viewport hasn't moved meaningfully
      if (!boundsSignificantlyChanged(lastFetchedBounds.value, bounds)) {
        // Still prune stale vehicles even when skipping fetch
        pruneStale()
        return
      }

      fetchVehicles(bounds)
    }

    function pruneStale() {
      const now = Date.now()
      let changed = false
      for (const [id, v] of vehicles.value) {
        if (now - new Date(v.timestamp).getTime() > STALE_THRESHOLD_MS) {
          vehicles.value.delete(id)
          changed = true
        }
      }
      if (changed) {
        // Trigger reactivity by replacing the ref
        vehicles.value = new Map(vehicles.value)
      }
    }

    function startPolling(getBounds: () => Bounds | null) {
      if (isPolling.value) return
      isPolling.value = true
      getBoundsFn = getBounds

      // Immediate first fetch
      pollOnce()

      pollTimer = setInterval(pollOnce, POLL_INTERVAL_MS)
    }

    function stopPolling() {
      if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
      }
      isPolling.value = false
      getBoundsFn = null
      vehicles.value = new Map()
      lastFetchedBounds.value = null
      lastFetchedAt.value = null
    }

    return {
      vehicles,
      vehicleList,
      count,
      isPolling,
      startPolling,
      stopPolling,
      fetchVehicles,
    }
  },
)
