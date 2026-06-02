/**
 * Route Detail Store
 *
 * Manages the active transit route detail state. When a route is active,
 * the map isolates that line (fades others, highlights the route shape,
 * shows station markers, and displays live vehicles for just that route).
 *
 * Entry points:
 *   - PlaceTransitPage: clicking a route badge
 *   - TripDetail: clicking a transit segment
 */

import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { api } from '@/lib/api'
import { send as wsSend } from '@/lib/realtime'
import { registerRealtimeHandlers } from '@/lib/realtime-events'
import type { TransitVehiclePosition } from '@/types/multimodal.types'

export interface RouteDetailStop {
  stopId: string
  stopName: string
  lat: number
  lng: number
  distanceAlongRoute: number
}

export interface RouteDetail {
  feedId: string
  routeId: string
  routeShortName: string | null
  routeLongName: string | null
  routeColor: string | null
  routeTextColor: string | null
  routeType: number | null
  agencyName: string | null
  stops: RouteDetailStop[]
  coordinates: [number, number][] | null
  relatedRouteIds: string[]
}

export const useRouteDetailStore = defineStore('route-detail', () => {
  // ── State ────────────────────────────────────────────────────────
  const activeRoute = ref<RouteDetail | null>(null)
  const isLoading = ref(false)
  const vehicles = ref<Map<string, TransitVehiclePosition>>(new Map())

  // ── Getters ──────────────────────────────────────────────────────
  const isActive = computed(() => activeRoute.value !== null)
  const routeColor = computed(() =>
    activeRoute.value?.routeColor
      ? `#${activeRoute.value.routeColor}`
      : null,
  )

  /** All route IDs to show vehicles for (active + related trunk routes). */
  const activeRouteIds = computed(() => {
    if (!activeRoute.value) return []
    return [
      activeRoute.value.routeId,
      ...activeRoute.value.relatedRouteIds,
    ]
  })

  const vehicleList = computed(() => Array.from(vehicles.value.values()))

  // ── Actions ──────────────────────────────────────────────────────

  async function openRoute(feedId: string, routeId: string) {
    isLoading.value = true
    try {
      const { data } = await api.get<RouteDetail>(
        '/proxy/transit/route-detail',
        { params: { feedId, routeId } },
      )
      activeRoute.value = data

      // Subscribe to vehicles for this route + related routes
      subscribeVehicles()
    } catch (err) {
      console.error('[RouteDetail] Failed to load route:', err)
    } finally {
      isLoading.value = false
    }
  }

  function closeRoute() {
    unsubscribeVehicles()
    activeRoute.value = null
    vehicles.value = new Map()
  }

  // ── Vehicle subscription ─────────────────────────────────────────

  function subscribeVehicles() {
    if (!activeRoute.value) return
    const routeIds = activeRouteIds.value
    wsSend({
      type: 'transit:subscribe-route',
      feedId: activeRoute.value.feedId,
      routeIds,
    })
  }

  function unsubscribeVehicles() {
    wsSend({ type: 'transit:unsubscribe' })
  }

  function applyVehicleUpdate(payload: unknown) {
    const data = payload as {
      vehicles?: TransitVehiclePosition[]
    }
    if (!data?.vehicles || !activeRoute.value) return

    const routeIds = new Set(activeRouteIds.value)
    const filtered = new Map<string, TransitVehiclePosition>()

    for (const v of data.vehicles) {
      // Filter to only active route IDs
      if (v.routeId && routeIds.has(v.routeId)) {
        filtered.set(v.vehicleId, v)
      }
      // Also match by routeShortName for cross-feed cases
      if (v.routeShortName && routeIds.has(v.routeShortName)) {
        filtered.set(v.vehicleId, v)
      }
    }

    vehicles.value = filtered
  }

  // ── Realtime handlers ────────────────────────────────────────────

  registerRealtimeHandlers('route-detail', {
    'transit:vehicles': applyVehicleUpdate,
    'realtime:reconnected': () => {
      if (activeRoute.value) subscribeVehicles()
    },
  })

  return {
    activeRoute,
    isLoading,
    isActive,
    routeColor,
    activeRouteIds,
    vehicles,
    vehicleList,
    openRoute,
    closeRoute,
  }
})
