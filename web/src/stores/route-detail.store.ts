/**
 * Route Detail Store
 *
 * Manages the active transit route detail view: route data, vehicle
 * tracking, direction selection, and vehicle selection state.
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

export interface DepartureContext {
  originStopName: string
  headsign: string
  departures: TransitDeparture[]
}

/** A vehicle projected onto the route's stop list. */
export interface VehicleOnRoute {
  vehicleId: string
  vehicle: TransitVehiclePosition
  /** Index of the stop the vehicle is approaching (or just passed). */
  nearestStopIndex: number
  /** 0-1 fraction between nearestStopIndex-1 and nearestStopIndex. */
  fractionBetweenStops: number
  /** Distance along route in meters. */
  distanceAlongRoute: number
}

export const useRouteDetailStore = defineStore('route-detail', () => {
  // ── State ────────────────────────────────────────────────────────
  const activeRoute = ref<RouteDetail | null>(null)
  const departureContext = ref<DepartureContext | null>(null)
  const isLoading = ref(false)
  const vehicles = ref<Map<string, TransitVehiclePosition>>(new Map())
  const selectedVehicleId = ref<string | null>(null)

  // ── Getters ──────────────────────────────────────────────────────
  const isActive = computed(() => activeRoute.value !== null)
  const routeColor = computed(() =>
    activeRoute.value?.routeColor
      ? `#${activeRoute.value.routeColor}`
      : null,
  )

  const activeRouteIds = computed(() => {
    if (!activeRoute.value) return []
    return [activeRoute.value.routeId, ...activeRoute.value.relatedRouteIds]
  })

  const vehicleList = computed(() => Array.from(vehicles.value.values()))

  const selectedVehicle = computed(() =>
    selectedVehicleId.value ? vehicles.value.get(selectedVehicleId.value) ?? null : null,
  )

  /** Vehicles projected onto the route timeline. */
  const vehiclesOnRoute = computed((): VehicleOnRoute[] => {
    const route = activeRoute.value
    if (!route || !route.stops.length) return []

    const result: VehicleOnRoute[] = []
    for (const v of vehicles.value.values()) {
      const projected = projectVehicleOnRoute(v, route.stops)
      if (projected) result.push(projected)
    }
    return result
  })

  /** Directions available (derived from departure headsigns). */
  const directions = computed(() => {
    if (!departureContext.value) return []
    const headsigns = new Set<string>()
    for (const dep of departureContext.value.departures) {
      const h = dep.headsign || dep.direction
      if (h) headsigns.add(h)
    }
    return [...headsigns]
  })

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
    return Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length)
  })

  // ── Actions ──────────────────────────────────────────────────────

  async function openRoute(
    feedId: string,
    routeId: string,
    context?: DepartureContext,
  ) {
    isLoading.value = true
    departureContext.value = context ?? null
    selectedVehicleId.value = null
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
    selectedVehicleId.value = null
    vehicles.value = new Map()
  }

  function selectVehicle(vehicleId: string | null) {
    selectedVehicleId.value = vehicleId
  }

  // ── Vehicle projection ──────────────────────────────────────────

  function projectVehicleOnRoute(
    v: TransitVehiclePosition,
    stops: RouteDetailStop[],
  ): VehicleOnRoute | null {
    if (stops.length < 2) return null

    const vLat = v.position.lat
    const vLng = v.position.lng

    // Find nearest stop by distance
    let bestIdx = 0
    let bestDist = Infinity
    for (let i = 0; i < stops.length; i++) {
      const d = haversineQuick(vLat, vLng, stops[i].lat, stops[i].lng)
      if (d < bestDist) {
        bestDist = d
        bestIdx = i
      }
    }

    // Determine if the vehicle is before or after the nearest stop
    // by checking distance to adjacent stops
    let prevIdx = Math.max(0, bestIdx - 1)
    let nextIdx = Math.min(stops.length - 1, bestIdx + 1)

    // Project onto the segment between prev and next stop
    let segStartIdx: number
    let segEndIdx: number
    if (bestIdx === 0) {
      segStartIdx = 0
      segEndIdx = 1
    } else if (bestIdx === stops.length - 1) {
      segStartIdx = stops.length - 2
      segEndIdx = stops.length - 1
    } else {
      const dPrev = haversineQuick(vLat, vLng, stops[prevIdx].lat, stops[prevIdx].lng)
      const dNext = haversineQuick(vLat, vLng, stops[nextIdx].lat, stops[nextIdx].lng)
      if (dPrev < dNext) {
        segStartIdx = prevIdx
        segEndIdx = bestIdx
      } else {
        segStartIdx = bestIdx
        segEndIdx = nextIdx
      }
    }

    const segLen = stops[segEndIdx].distanceAlongRoute - stops[segStartIdx].distanceAlongRoute
    if (segLen <= 0) {
      return {
        vehicleId: v.vehicleId,
        vehicle: v,
        nearestStopIndex: bestIdx,
        fractionBetweenStops: 0,
        distanceAlongRoute: stops[bestIdx].distanceAlongRoute,
      }
    }

    // Project vehicle position between the two stops
    const dToStart = haversineQuick(vLat, vLng, stops[segStartIdx].lat, stops[segStartIdx].lng)
    const dToEnd = haversineQuick(vLat, vLng, stops[segEndIdx].lat, stops[segEndIdx].lng)
    const totalD = dToStart + dToEnd
    const frac = totalD > 0 ? Math.min(1, Math.max(0, dToStart / totalD)) : 0

    return {
      vehicleId: v.vehicleId,
      vehicle: v,
      nearestStopIndex: segEndIdx,
      fractionBetweenStops: frac,
      distanceAlongRoute: stops[segStartIdx].distanceAlongRoute + segLen * frac,
    }
  }

  function haversineQuick(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const dLat = lat2 - lat1
    const dLng = (lng2 - lng1) * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180)
    return Math.sqrt(dLat * dLat + dLng * dLng)
  }

  // ── Vehicle subscription ─────────────────────────────────────────

  function subscribeVehicles() {
    if (!activeRoute.value) return
    const bounds = computeRouteBounds()
    if (!bounds) return
    wsSend({ type: 'transit:subscribe', bounds })
  }

  function unsubscribeVehicles() {
    wsSend({ type: 'transit:unsubscribe' })
  }

  function computeRouteBounds() {
    const route = activeRoute.value
    if (!route) return null

    let north = -90, south = 90, east = -180, west = 180
    if (route.coordinates) {
      for (const [lng, lat] of route.coordinates) {
        if (lat > north) north = lat
        if (lat < south) south = lat
        if (lng > east) east = lng
        if (lng < west) west = lng
      }
    }
    for (const stop of route.stops) {
      if (stop.lat > north) north = stop.lat
      if (stop.lat < south) south = stop.lat
      if (stop.lng > east) east = stop.lng
      if (stop.lng < west) west = stop.lng
    }
    if (north === -90) return null
    const latPad = (north - south) * 0.1
    const lngPad = (east - west) * 0.1
    return { north: north + latPad, south: south - latPad, east: east + lngPad, west: west - lngPad }
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

    // Auto-clear selection if the vehicle disappeared
    if (selectedVehicleId.value && !filtered.has(selectedVehicleId.value)) {
      selectedVehicleId.value = null
    }
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
    vehiclesOnRoute,
    selectedVehicleId,
    selectedVehicle,
    directions,
    upcomingDepartures,
    headwayMinutes,
    openRoute,
    closeRoute,
    selectVehicle,
  }
})
