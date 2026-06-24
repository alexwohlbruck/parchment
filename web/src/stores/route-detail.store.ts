/**
 * Route Detail Store
 *
 * Manages the active transit route detail view: route data, vehicle
 * tracking, direction selection, and vehicle selection state.
 */

import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { api } from '@/lib/api'
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

  /** Stop times for the selected vehicle's trip (from TripUpdate data). */
  interface TripStopTime {
    stopId: string
    arrivalTime?: string
    departureTime?: string
  }
  const tripStopTimes = ref<TripStopTime[]>([])

  /** Map of stopId → time string for the selected vehicle's trip. */
  const stopTimeMap = computed(() => {
    const map = new Map<string, string>()
    for (const st of tripStopTimes.value) {
      const time = st.departureTime || st.arrivalTime
      if (time && st.stopId) {
        map.set(st.stopId, time)
      }
    }
    return map
  })

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

  /** Directions available. Prefers departure headsigns if available,
   *  otherwise derives from first/last stop names on the route. */
  const directions = computed(() => {
    // From departure context (when opened from a stop page)
    if (departureContext.value) {
      const headsigns = new Set<string>()
      for (const dep of departureContext.value.departures) {
        const h = dep.headsign || dep.direction
        if (h) headsigns.add(h)
      }
      if (headsigns.size >= 2) return [...headsigns]
    }

    // Derive from route stops (first → last, last → first)
    const stops = activeRoute.value?.stops
    if (!stops || stops.length < 2) return []
    const first = stops[0].stopName
    const last = stops[stops.length - 1].stopName
    return [`To ${last}`, `To ${first}`]
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

  let vehiclePollTimer: ReturnType<typeof setInterval> | null = null
  /** Generation counter to guard against concurrent openRoute races. */
  let openGeneration = 0

  async function openRoute(
    feedId: string,
    routeId: string,
    context?: DepartureContext,
  ) {
    const gen = ++openGeneration
    isLoading.value = true
    departureContext.value = context ?? null
    selectedVehicleId.value = null
    stopVehiclePolling()
    try {
      const { data } = await api.get<RouteDetail>(
        '/proxy/transit/route-detail',
        { params: { feedId, routeId } },
      )
      // Guard: if another openRoute was called while we awaited, bail
      if (gen !== openGeneration) return
      activeRoute.value = data
      startVehiclePolling()
    } catch (err) {
      if (gen !== openGeneration) return
      console.error('[RouteDetail] Failed to load route:', err)
    } finally {
      if (gen === openGeneration) isLoading.value = false
    }
  }

  function closeRoute() {
    stopVehiclePolling()
    activeRoute.value = null
    departureContext.value = null
    selectedVehicleId.value = null
    selectedDirection.value = null
    tripStopTimes.value = []
    vehicles.value = new Map()
  }

  let tripStopFetchId = 0

  function selectVehicle(vehicleId: string | null) {
    selectedVehicleId.value = vehicleId
    tripStopTimes.value = []
    tripStopFetchId++

    if (vehicleId && activeRoute.value) {
      const vehicle = vehicles.value.get(vehicleId)
      if (vehicle?.tripId) {
        const rawTripId = vehicle.tripId.startsWith(`${vehicle.feedId}_`)
          ? vehicle.tripId.slice(vehicle.feedId.length + 1)
          : vehicle.tripId
        void fetchTripStopTimes(vehicle.feedId, rawTripId, vehicleId)
      }
    }
  }

  async function fetchTripStopTimes(feedId: string, tripId: string, forVehicleId: string) {
    const fetchId = tripStopFetchId
    try {
      const { data } = await api.get<{ stops: Array<{ stopId: string; arrivalTime?: string; departureTime?: string }> }>(
        '/proxy/transit/trip-stops',
        { params: { feedId, tripId } },
      )
      // Guard against stale write: only apply if the vehicle is still selected
      if (fetchId !== tripStopFetchId || selectedVehicleId.value !== forVehicleId) return
      if (data?.stops) {
        tripStopTimes.value = data.stops
      }
    } catch {
      // Trip stop times unavailable — fine, we just won't show them
    }
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

    // Project the vehicle onto the route shape to get its distance
    // along the route — this matches how the map renders the vehicle.
    const vehicleDist = projectOntoShape(
      v.position.lat, v.position.lng, coordinates, stops,
    )

    // Find which two stops bracket this distance
    let segStartIdx = 0
    for (let i = 0; i < stops.length - 1; i++) {
      if (vehicleDist >= stops[i].distanceAlongRoute) {
        segStartIdx = i
      }
    }
    const segEndIdx = Math.min(segStartIdx + 1, stops.length - 1)

    // Fraction between the two bracketing stops
    const segLen = stops[segEndIdx].distanceAlongRoute - stops[segStartIdx].distanceAlongRoute
    const frac = segLen > 0
      ? Math.max(0, Math.min(1, (vehicleDist - stops[segStartIdx].distanceAlongRoute) / segLen))
      : 0

    // Timeline position: equidistant stops, so use index-based fraction
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
      distanceAlongRoute: vehicleDist,
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

  /**
   * Project a vehicle position onto the route shape to get distance
   * along the route. Falls back to nearest-stop distance if no shape.
   */
  function projectOntoShape(
    lat: number,
    lng: number,
    coordinates: [number, number][] | null | undefined,
    stops: RouteDetailStop[],
  ): number {
    if (coordinates && coordinates.length >= 2) {
      // Build cumulative distances along the shape
      let cumDist = 0
      let bestDist = Infinity
      let bestAlong = 0

      for (let i = 0; i < coordinates.length - 1; i++) {
        const [aLng, aLat] = coordinates[i]
        const [bLng, bLat] = coordinates[i + 1]
        const segLen = haversineQuick(aLat, aLng, bLat, bLng)

        // Project point onto segment
        const dx = bLng - aLng
        const dy = bLat - aLat
        const lenSq = dx * dx + dy * dy
        const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((lng - aLng) * dx + (lat - aLat) * dy) / lenSq))

        const projLat = aLat + dy * t
        const projLng = aLng + dx * t
        const d = haversineQuick(lat, lng, projLat, projLng)

        if (d < bestDist) {
          bestDist = d
          bestAlong = cumDist + segLen * t
        }
        cumDist += segLen
      }

      // Convert shape distance to stop distance scale
      // (shape coordinates and stops use the same distance metric from Barrelman)
      const totalShapeDist = cumDist
      const totalStopDist = stops[stops.length - 1].distanceAlongRoute - stops[0].distanceAlongRoute
      if (totalShapeDist > 0 && totalStopDist > 0) {
        return stops[0].distanceAlongRoute + (bestAlong / totalShapeDist) * totalStopDist
      }
      return bestAlong
    }

    // Fallback: find nearest stop
    let bestIdx = 0
    let bestD = Infinity
    for (let i = 0; i < stops.length; i++) {
      const d = haversineQuick(lat, lng, stops[i].lat, stops[i].lng)
      if (d < bestD) { bestD = d; bestIdx = i }
    }
    return stops[bestIdx].distanceAlongRoute
  }

  function haversineQuick(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const dLat = lat2 - lat1
    const dLng = (lng2 - lng1) * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180)
    return Math.sqrt(dLat * dLat + dLng * dLng)
  }

  // ── Vehicle polling ──────────────────────────────────────────────
  // Polls the route-specific endpoint which returns ALL vehicles on
  // the route — no bounding box, no WebSocket subscription needed.

  const VEHICLE_POLL_MS = 5_000

  function startVehiclePolling() {
    stopVehiclePolling()
    fetchRouteVehicles()
    vehiclePollTimer = setInterval(fetchRouteVehicles, VEHICLE_POLL_MS)
  }

  function stopVehiclePolling() {
    if (vehiclePollTimer) {
      clearInterval(vehiclePollTimer)
      vehiclePollTimer = null
    }
  }

  async function fetchRouteVehicles() {
    if (!activeRoute.value) return
    const routeIds = activeRouteIds.value
    if (routeIds.length === 0) return

    try {
      // Try the route-specific endpoint first (no bounds needed)
      let vehicleData: TransitVehiclePosition[] | null = null

      try {
        const { data } = await api.get<{ vehicles: TransitVehiclePosition[] }>(
          '/proxy/transit/route-vehicles',
          { params: { routeIds: routeIds.join(','), feedId: activeRoute.value.feedId } },
        )
        vehicleData = data?.vehicles ?? null
      } catch {
        // Endpoint not available (server needs restart) — fall back to bbox
      }

      // Fallback: use the bbox vehicles endpoint with a wide bounds
      if (!vehicleData) {
        const bounds = routeBounds()
        if (!bounds) return
        const { data } = await api.get<{ vehicles: TransitVehiclePosition[] }>(
          '/proxy/transit/vehicles',
          { params: bounds },
        )
        // Filter to our routes client-side
        const routeIdSet = new Set(routeIds)
        vehicleData = (data?.vehicles ?? []).filter(v =>
          (v.routeId && routeIdSet.has(v.routeId)) ||
          (v.routeShortName && routeIdSet.has(v.routeShortName)),
        )
      }

      const updated = new Map<string, TransitVehiclePosition>()
      for (const v of vehicleData) {
        updated.set(v.vehicleId, v)
      }
      vehicles.value = updated

      if (selectedVehicleId.value && !updated.has(selectedVehicleId.value)) {
        selectedVehicleId.value = null
      }
    } catch {
      // Will retry on next poll
    }
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
    const latPad = (north - south) * 0.3
    const lngPad = (east - west) * 0.3
    return { north: north + latPad, south: south - latPad, east: east + lngPad, west: west - lngPad }
  }

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
    tripStopTimes,
    stopTimeMap,
    openRoute,
    closeRoute,
    selectVehicle,
    setDirection,
  }
})
