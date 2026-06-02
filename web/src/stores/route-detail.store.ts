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
  /** 0-1 position along the entire route (for timeline placement). */
  routeFraction: number
  /** True if the vehicle is moving in the original stop-list direction (start→end). */
  isForwardDirection: boolean
}

export const useRouteDetailStore = defineStore('route-detail', () => {
  // ── State ────────────────────────────────────────────────────────
  const activeRoute = ref<RouteDetail | null>(null)
  const departureContext = ref<DepartureContext | null>(null)
  const isLoading = ref(false)
  const vehicles = ref<Map<string, TransitVehiclePosition>>(new Map())
  const selectedVehicleId = ref<string | null>(null)
  const selectedDirection = ref<string | null>(null)

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

  /** Vehicle IDs that should show on the map (filtered to active direction). */
  const directionFilteredVehicleIds = computed(() => {
    return new Set(vehiclesOnRoute.value.map(vr => vr.vehicleId))
  })

  const selectedVehicle = computed(() =>
    selectedVehicleId.value ? vehicles.value.get(selectedVehicleId.value) ?? null : null,
  )

  /** All vehicles projected onto the original (non-reversed) stop list. */
  const allVehiclesOnRoute = computed((): VehicleOnRoute[] => {
    const route = activeRoute.value
    if (!route || !route.stops.length) return []

    const result: VehicleOnRoute[] = []
    for (const v of vehicles.value.values()) {
      const projected = projectVehicleOnRoute(v, route.stops, route.coordinates)
      if (projected) result.push(projected)
    }
    return result
  })

  /** Vehicles filtered to the selected direction and mapped to display-order indices. */
  const vehiclesOnRoute = computed((): VehicleOnRoute[] => {
    const reversed = isReversed.value
    // Show forward vehicles when viewing original direction,
    // reverse vehicles when viewing reversed direction
    const filtered = allVehiclesOnRoute.value.filter(
      vr => reversed ? !vr.isForwardDirection : vr.isForwardDirection,
    )

    // Remap routeFraction for reversed display
    if (reversed) {
      return filtered
        .map(vr => ({ ...vr, routeFraction: 1 - vr.routeFraction }))
        .sort((a, b) => a.routeFraction - b.routeFraction)
    }
    return filtered.sort((a, b) => a.routeFraction - b.routeFraction)
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

  /** Whether the current direction reverses the stop list. */
  const isReversed = computed(() => {
    if (directions.value.length < 2 || !activeDirection.value) return false
    return directions.value.indexOf(activeDirection.value) === 1
  })

  /** Stops in display order (reversed for the second direction). */
  const displayStops = computed(() => {
    const stops = activeRoute.value?.stops ?? []
    return isReversed.value ? [...stops].reverse() : stops
  })

  /** Active direction (auto-selects first if not set). */
  const activeDirection = computed(() => {
    if (selectedDirection.value && directions.value.includes(selectedDirection.value)) {
      return selectedDirection.value
    }
    return directions.value[0] ?? null
  })

  /** Upcoming departures filtered to the active direction. */
  const upcomingDepartures = computed(() => {
    if (!departureContext.value) return []
    const now = Date.now()
    const dir = activeDirection.value
    return departureContext.value.departures
      .filter(d => {
        if (dir) {
          const h = d.headsign || d.direction
          if (h !== dir) return false
        }
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
    selectedDirection.value = null
    vehicles.value = new Map()
  }

  function selectVehicle(vehicleId: string | null) {
    selectedVehicleId.value = vehicleId
  }

  function setDirection(headsign: string) {
    selectedDirection.value = headsign
  }

  // ── Vehicle projection ──────────────────────────────────────────

  function projectVehicleOnRoute(
    v: TransitVehiclePosition,
    stops: RouteDetailStop[],
    coordinates?: [number, number][] | null,
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

    const segLen = Math.abs(stops[segEndIdx].distanceAlongRoute - stops[segStartIdx].distanceAlongRoute)
    const totalRouteLen = Math.abs(
      stops[stops.length - 1].distanceAlongRoute - stops[0].distanceAlongRoute,
    )

    // Project vehicle position between the two stops
    const dToStart = haversineQuick(vLat, vLng, stops[segStartIdx].lat, stops[segStartIdx].lng)
    const dToEnd = haversineQuick(vLat, vLng, stops[segEndIdx].lat, stops[segEndIdx].lng)
    const totalD = dToStart + dToEnd
    const frac = totalD > 0 ? Math.min(1, Math.max(0, dToStart / totalD)) : 0

    const distAlong = stops[segStartIdx].distanceAlongRoute +
      (stops[segEndIdx].distanceAlongRoute - stops[segStartIdx].distanceAlongRoute) * frac

    // Compute route fraction: position as 0-1 along the stop list indices
    // (not distance — we want even spacing on the timeline)
    const indexFraction = (segStartIdx + frac) / Math.max(1, stops.length - 1)

    // Determine travel direction by comparing vehicle bearing to
    // the route segment bearing at this position
    const isForward = computeIsForward(
      v.bearing,
      stops[segStartIdx],
      stops[segEndIdx],
    )

    return {
      vehicleId: v.vehicleId,
      vehicle: v,
      nearestStopIndex: segEndIdx,
      fractionBetweenStops: frac,
      distanceAlongRoute: distAlong,
      routeFraction: Math.max(0, Math.min(1, indexFraction)),
      isForwardDirection: isForward,
    }
  }

  /** Compare vehicle bearing to the segment bearing to determine travel direction. */
  function computeIsForward(
    vehicleBearing: number | undefined,
    fromStop: RouteDetailStop,
    toStop: RouteDetailStop,
  ): boolean {
    if (vehicleBearing == null) return true // assume forward if no bearing

    // Bearing from fromStop → toStop (the "forward" direction of the route)
    const segBearing = Math.atan2(
      toStop.lng - fromStop.lng,
      toStop.lat - fromStop.lat,
    ) * 180 / Math.PI
    const normalizedSeg = ((segBearing % 360) + 360) % 360

    // Angular difference
    let diff = Math.abs(vehicleBearing - normalizedSeg)
    if (diff > 180) diff = 360 - diff

    // < 90° means same direction as stop ordering = forward
    return diff < 90
  }

  function haversineQuick(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const dLat = lat2 - lat1
    const dLng = (lng2 - lng1) * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180)
    return Math.sqrt(dLat * dLat + dLng * dLng)
  }

  // ── Vehicle subscription ─────────────────────────────────────────
  // Subscribe with a wide bbox covering the entire route so we get
  // ALL vehicles on the line, not just the ones in the current viewport.

  function subscribeVehicles() {
    if (!activeRoute.value) return
    // Use a generous bbox covering the full route extent
    const bounds = routeBounds()
    if (!bounds) return
    wsSend({ type: 'transit:subscribe', bounds })
  }

  function unsubscribeVehicles() {
    wsSend({ type: 'transit:unsubscribe' })
  }

  function routeBounds() {
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
    // Generous padding to catch vehicles slightly beyond terminus
    const latPad = (north - south) * 0.3
    const lngPad = (east - west) * 0.3
    return {
      north: Math.min(90, north + latPad),
      south: Math.max(-90, south - latPad),
      east: Math.min(180, east + lngPad),
      west: Math.max(-180, west - lngPad),
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
    isReversed,
    displayStops,
    directionFilteredVehicleIds,
    selectedDirection,
    activeDirection,
    openRoute,
    closeRoute,
    selectVehicle,
    setDirection,
  }
})
