/**
 * Transit Vehicles Store
 *
 * Manages live GTFS-RT vehicle positions received via WebSocket.
 * The server polls Barrelman on our behalf and pushes vehicle state
 * to all subscribed clients. This store handles:
 *
 *   - Subscribing/unsubscribing the WS connection with viewport bounds
 *   - Receiving `transit:vehicles` events and updating the reactive Map
 *   - Pruning stale vehicles that haven't been updated recently
 */

import { ref, computed, watch } from 'vue'
import { defineStore } from 'pinia'
import { send as wsSend, connectionState } from '@/lib/realtime'
import { registerRealtimeHandlers } from '@/lib/realtime-events'
import type { TransitVehiclePosition } from '@/types/multimodal.types'

/** Drop vehicles whose last report is older than this (ms). */
const STALE_THRESHOLD_MS = 2 * 60 * 1000

interface Bounds {
  north: number
  south: number
  east: number
  west: number
}

export const useTransitVehiclesStore = defineStore(
  'transit-vehicles',
  () => {
    // ── State ──────────────────────────────────────────────────────────
    const vehicles = ref<Map<string, TransitVehiclePosition>>(new Map())
    const isSubscribed = ref(false)

    let getBoundsFn: (() => Bounds | null) | null = null

    // ── Getters ────────────────────────────────────────────────────────
    const vehicleList = computed(() => Array.from(vehicles.value.values()))
    const count = computed(() => vehicles.value.size)

    // ── WebSocket subscription ─────────────────────────────────────────

    function subscribe(getBounds: () => Bounds | null) {
      if (isSubscribed.value) return
      getBoundsFn = getBounds

      const bounds = getBounds()
      if (!bounds) return

      isSubscribed.value = true
      wsSend({ type: 'transit:subscribe', bounds })
    }

    function unsubscribe() {
      if (!isSubscribed.value) return
      isSubscribed.value = false
      getBoundsFn = null
      vehicles.value = new Map()
      wsSend({ type: 'transit:unsubscribe' })
    }

    /** Send updated viewport bounds to the server. */
    function updateViewport() {
      if (!isSubscribed.value || !getBoundsFn) return
      const bounds = getBoundsFn()
      if (!bounds) return
      wsSend({ type: 'transit:viewport', bounds })
    }

    // ── Handle incoming vehicle data ──────────────────────────────────

    function applyVehicleUpdate(payload: unknown) {
      const data = payload as {
        vehicles?: TransitVehiclePosition[]
        feedTimestamps?: Record<string, string>
      }

      if (!data?.vehicles) return

      const now = Date.now()
      const merged = new Map<string, TransitVehiclePosition>()

      // Add all incoming vehicles (skip stale)
      for (const v of data.vehicles) {
        const age = now - new Date(v.timestamp).getTime()
        if (age > STALE_THRESHOLD_MS) continue
        merged.set(v.vehicleId, v)
      }

      vehicles.value = merged
    }

    // ── Reconnect handling ────────────────────────────────────────────

    function onReconnected() {
      if (isSubscribed.value && getBoundsFn) {
        const bounds = getBoundsFn()
        if (bounds) {
          wsSend({ type: 'transit:subscribe', bounds })
        }
      }
    }

    // Re-subscribe when WS (re)connects
    watch(connectionState, (state) => {
      if (state === 'open' && isSubscribed.value && getBoundsFn) {
        const bounds = getBoundsFn()
        if (bounds) {
          wsSend({ type: 'transit:subscribe', bounds })
        }
      }
    })

    // ── Register realtime handlers ────────────────────────────────────

    registerRealtimeHandlers('transit-vehicles', {
      'transit:vehicles': applyVehicleUpdate,
      'realtime:reconnected': onReconnected,
    })

    return {
      vehicles,
      vehicleList,
      count,
      isSubscribed,
      subscribe,
      unsubscribe,
      updateViewport,
    }
  },
)
