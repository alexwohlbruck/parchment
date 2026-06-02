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
    // Compute bounds from the route shape or stops
    const bounds = computeRouteBounds()
    if (!bounds) return
    wsSend({ type: 'transit:subscribe', bounds })
  }

  function unsubscribeVehicles() {
    wsSend({ type: 'transit:unsubscribe' })
  }

  /** Compute a bounding box that covers the entire route. */
  function computeRouteBounds() {
    const route = activeRoute.value
    if (!route) return null

    let north = -90, south = 90, east = -180, west = 180

    // From shape coordinates
    if (route.coordinates) {
      for (const [lng, lat] of route.coordinates) {
        if (lat > north) north = lat
        if (lat < south) south = lat
        if (lng > east) east = lng
        if (lng < west) west = lng
      }
    }

    // From stops (in case shape is missing)
    for (const stop of route.stops) {
      if (stop.lat > north) north = stop.lat
      if (stop.lat < south) south = stop.lat
      if (stop.lng > east) east = stop.lng
      if (stop.lng < west) west = stop.lng
    }

    if (north === -90) return null

    // Pad by 10%
    const latPad = (north - south) * 0.1
    const lngPad = (east - west) * 0.1
    return {
      north: north + latPad,
      south: south - latPad,
      east: east + lngPad,
      west: west - lngPad,
    }
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
