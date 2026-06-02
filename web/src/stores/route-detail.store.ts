/**
 * Route Detail Store
 *
 * Manages the active transit route detail state. When a route is active,
 * the map isolates that line (fades others, highlights the route shape,
 * shows station markers, and displays live vehicles for just that route).
 */

import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { api } from '@/lib/api'
import { send as wsSend } from '@/lib/realtime'
import { registerRealtimeHandlers } from '@/lib/realtime-events'
import type { TransitVehiclePosition } from '@/types/multimodal.types'
import type { TransitDeparture } from '@/types/place.types'

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

/** Departure context passed from the transit stop page. */
export interface DepartureContext {
  /** The stop the user opened from. */
  originStopName: string
  /** Headsign/direction of the selected departure. */
  headsign: string
  /** All departures for this route at the origin stop. */
  departures: TransitDeparture[]
}

export const useRouteDetailStore = defineStore('route-detail', () => {
  // ── State ────────────────────────────────────────────────────────
  const activeRoute = ref<RouteDetail | null>(null)
  const departureContext = ref<DepartureContext | null>(null)
  const isLoading = ref(false)
  const vehicles = ref<Map<string, TransitVehiclePosition>>(new Map())

  // ── Getters ──────────────────────────────────────────────────────
  const isActive = computed(() => activeRoute.value !== null)
  const routeColor = computed(() =>
    activeRoute.value?.routeColor
      ? `#${activeRoute.value.routeColor}`
      : null,
  )

  const activeRouteIds = computed(() => {
    if (!activeRoute.value) return []
    return [
      activeRoute.value.routeId,
      ...activeRoute.value.relatedRouteIds,
    ]
  })

  const vehicleList = computed(() => Array.from(vehicles.value.values()))

  /** Index of the origin stop in the stop list (-1 if not found). */
  const originStopIndex = computed(() => {
    if (!activeRoute.value || !departureContext.value) return -1
    const name = departureContext.value.originStopName.toLowerCase()
    return activeRoute.value.stops.findIndex(
      s => s.stopName.toLowerCase().includes(name) || name.includes(s.stopName.toLowerCase()),
    )
  })

  /** Upcoming departures grouped by direction/headsign. */
  const upcomingDepartures = computed(() => {
    if (!departureContext.value) return []
    const now = Date.now()
    return departureContext.value.departures
      .filter(d => {
        const depAt = d.departureAt || d.arrivalAt
        if (!depAt) return true
        return new Date(depAt).getTime() >= now - 60_000
      })
      .slice(0, 5)
  })

  /** Average headway in minutes (from departure intervals). */
  const headwayMinutes = computed(() => {
    const deps = upcomingDepartures.value
    if (deps.length < 2) return null
    const times = deps
      .map(d => {
        const at = d.departureAt || d.arrivalAt
        return at ? new Date(at).getTime() : null
      })
      .filter((t): t is number => t !== null)
      .sort((a, b) => a - b)

    if (times.length < 2) return null
    const intervals: number[] = []
    for (let i = 1; i < times.length; i++) {
      intervals.push((times[i] - times[i - 1]) / 60_000)
    }
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length
    return Math.round(avg)
  })

  // ── Actions ──────────────────────────────────────────────────────

  async function openRoute(
    feedId: string,
    routeId: string,
    context?: DepartureContext,
  ) {
    isLoading.value = true
    departureContext.value = context ?? null
    try {
      const { data } = await api.get<RouteDetail>(
        '/proxy/transit/route-detail',
        { params: { feedId, routeId } },
      )
      activeRoute.value = data
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
    departureContext.value = null
    vehicles.value = new Map()
  }

  // ── Vehicle subscription ─────────────────────────────────────────

  function subscribeVehicles() {
    if (!activeRoute.value) return
    wsSend({
      type: 'transit:subscribe-route',
      feedId: activeRoute.value.feedId,
      routeIds: activeRouteIds.value,
    })
  }

  function unsubscribeVehicles() {
    wsSend({ type: 'transit:unsubscribe' })
  }

  function applyVehicleUpdate(payload: unknown) {
    const data = payload as { vehicles?: TransitVehiclePosition[] }
    if (!data?.vehicles || !activeRoute.value) return

    const routeIds = new Set(activeRouteIds.value)
    const filtered = new Map<string, TransitVehiclePosition>()
    for (const v of data.vehicles) {
      if ((v.routeId && routeIds.has(v.routeId)) ||
          (v.routeShortName && routeIds.has(v.routeShortName))) {
        filtered.set(v.vehicleId, v)
      }
    }
    vehicles.value = filtered
  }

  registerRealtimeHandlers('route-detail', {
    'transit:vehicles': applyVehicleUpdate,
    'realtime:reconnected': () => {
      if (activeRoute.value) subscribeVehicles()
    },
  })

  return {
    activeRoute,
    departureContext,
    isLoading,
    isActive,
    routeColor,
    activeRouteIds,
    vehicles,
    vehicleList,
    originStopIndex,
    upcomingDepartures,
    headwayMinutes,
    openRoute,
    closeRoute,
  }
})
