/**
 * Route Detail Store
 *
 * Manages the active transit route detail view: route data, vehicle
 * tracking, direction selection, and vehicle selection state.
 */

import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { api } from '@/lib/api'
import { fetchVehiclesOnRoutes } from '@/lib/transit/transit-vehicle-fetch'
import type { TransitVehiclePosition } from '@/types/multimodal.types'
import { projectVehicleOnRoute } from '@/lib/transit/route-projection'
import type {
  StopTransferRoute,
  RouteDetailStop,
  RouteDetail,
  DepartureContext,
  VehicleOnRoute,
} from '@/types/transit.types'
import type { TransitDeparture } from '@/types/place.types'
import type { AlertServiceOverrides } from '@/lib/transit/alert-service-overrides'


export const useRouteDetailStore = defineStore('route-detail', () => {
  // ── State ────────────────────────────────────────────────────────
  const activeRoute = ref<RouteDetail | null>(null)
  const departureContext = ref<DepartureContext | null>(null)
  const isLoading = ref(false)
  const vehicles = ref<Map<string, TransitVehiclePosition>>(new Map())
  const selectedVehicleId = ref<string | null>(null)
  const selectedDirection = ref<string | null>(null)

  const stopRunningRoutes = ref(new Map<string, Set<string>>())
  const stopServiceKnown = ref(new Set<string>())

  /** Per-stop serve/skip pairs off the agency's in-effect alerts — the page
   *  computes them from the alerts it already fetches for display, so path
   *  and alert cards can never disagree about what the agency said. */
  const alertOverrides = ref<AlertServiceOverrides>({ serves: new Set(), skips: new Set() })
  function setAlertOverrides(overrides: AlertServiceOverrides) {
    alertOverrides.value = overrides
  }

  /** (stop → routes) pairs the alerts skip, across EVERY line — the page
   *  computes them from the same fetch as the overrides. Alerts name
   *  stations; matching is by a stop's own id or its parent's. */
  const stopSkips = ref(new Map<string, Set<string>>())
  function setStopSkips(skips: Map<string, Set<string>>) {
    stopSkips.value = skips
  }

  /**
   * The boards' answers with the agency's skips subtracted.
   *
   * The boards read MOTIS, which reads the schedule plus whatever realtime
   * reached it — and a planned skip often never does. On parade day the
   * board at Eastern Pkwy went on listing 2s and 3s at a station all three
   * lines were skipping. The alert is the agency saying so in as many
   * words, and it outranks a scheduled departure. Everything that judges
   * "is this line running here" — the panel's bullets, the running path,
   * the map — reads this, so no view can disagree with another.
   */
  const runningAtStops = computed(() => {
    const skips = stopSkips.value
    const raw = stopRunningRoutes.value
    if (!skips.size || !raw.size) return raw
    const parents = new Map(
      routeStops.value.map((s) => [s.stopId, s.parentStation] as const),
    )
    const out = new Map<string, Set<string>>()
    for (const [stopId, routes] of raw) {
      const skipped = new Set([
        ...(skips.get(stopId) ?? []),
        ...(skips.get(parents.get(stopId) ?? '') ?? []),
      ])
      out.set(
        stopId,
        skipped.size ? new Set([...routes].filter((r) => !skipped.has(r))) : routes,
      )
    }
    return out
  })

  /** Stop times for the selected vehicle's trip (from TripUpdate data). */
  interface TripStopTime {
    stopId: string
    /** GTFS parent station, when the run predicts against a platform. */
    parentStation?: string
    arrivalTime?: string
    departureTime?: string
  }
  const tripStopTimes = ref<TripStopTime[]>([])

  /**
   * stopId → time for the selected vehicle's trip.
   *
   * Filed under the platform AND its station: the MTA predicts against
   * `250N`, while this route's stop list — like every station-level view —
   * carries `250`, so keying on one id alone showed no times at all.
   */
  const stopTimeMap = computed(() => {
    const map = new Map<string, string>()
    for (const st of tripStopTimes.value) {
      const time = st.departureTime || st.arrivalTime
      if (!time) continue
      if (st.stopId) map.set(st.stopId, time)
      if (st.parentStation) map.set(st.parentStation, time)
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

  /** How far a stop may sit from the route's drawn shape and still count
   *  as on its track. Grand Army Plaza is metres from the 4's line under
   *  Eastern Pkwy; the New Lots branch is a kilometre off it. */
  const OWN_TRACK_M = 300

  /** Distance from each stop to the route's shape, computed once per
   *  route. No shape means no basis to judge, so every stop passes. */
  const shapeDistance = computed(() => {
    const coords = activeRoute.value?.coordinates
    const map = new Map<string, number>()
    if (!coords || coords.length < 2) return map
    for (const s of activeRoute.value?.stops ?? []) {
      const kx = 111_320 * Math.cos((s.lat * Math.PI) / 180)
      const ky = 110_540
      let best = Infinity
      for (let i = 1; i < coords.length; i++) {
        const [ax, ay] = coords[i - 1]
        const [bx, by] = coords[i]
        const dx = (bx - ax) * kx
        const dy = (by - ay) * ky
        const px = (s.lng - ax) * kx
        const py = (s.lat - ay) * ky
        const len = dx * dx + dy * dy
        const t = len ? Math.max(0, Math.min(1, (px * dx + py * dy) / len)) : 0
        const ddx = px - t * dx
        const ddy = py - t * dy
        const d = ddx * ddx + ddy * ddy
        if (d < best) best = d
      }
      map.set(s.stopId, Math.sqrt(best))
    }
    return map
  })

  const onOwnTrack = (s: RouteDetailStop) => {
    const d = shapeDistance.value.get(s.stopId)
    return d === undefined || d <= OWN_TRACK_M
  }

  /** Every stop the line calls at on its full timetable, in route order.
   *  What the service boards are asked about — never the filtered list, or
   *  narrowing it would narrow the next answer, and so on down to nothing. */
  const routeStops = computed(() => activeRoute.value?.stops ?? [])

  /**
   * The stops on the path the train is actually taking.
   *
   * A line's full timetable is not what it is doing at three in the morning.
   * The R's list runs Forest Hills to Bay Ridge, but overnight the R is the
   * Whitehall–Bay Ridge shuttle, and a timeline that draws the other thirty
   * stations is describing a train that isn't there.
   *
   * Two sources answer it, each trusted for what it actually says:
   *
   * The departure boards are the spine. A stop is on the path unless its
   * board came back and did not name this line. Unknown keeps it: an unread
   * board is missing evidence, not a closed station.
   *
   * The agency's alerts refine the middle of that spine. A planned reroute
   * often never reaches the boards — when the 4 ran local for a parade,
   * Grand Army Plaza's board went on answering "2, 3" — and the alert names
   * each (route, stop) pair it adds or skips. But an informed entity is
   * only "this alert concerns this stop", and the MTA attaches them
   * generously: the parade alert named the whole New Lots branch while its
   * own text said "between Atlantic Av and Crown Hts–Utica Av". So a named
   * stop is only ADDED when it lies ON the route's own track (an
   * express-to-local reroute serves stops along the line it already runs;
   * an extension leaves it) and between stops the boards confirm — filling
   * in a run's middle, never extending a terminus. A named skip applies
   * anywhere: removing on the agency's word risks a missing dot, not a
   * phantom train. Alerts name stations while this list carries platforms,
   * so a stop matches by its own id or its parent's.
   *
   * If no stop is known to be served at all, the whole line is drawn,
   * because a path of nothing describes nothing.
   */
  const servedStops = computed(() => {
    const stops = routeStops.value
    const routeId = activeRoute.value?.routeId
    if (!routeId) return stops
    const { serves, skips } = alertOverrides.value
    const named = (set: Set<string>, s: RouteDetailStop) =>
      set.has(s.stopId) || (s.parentStation != null && set.has(s.parentStation))
    if (!stopServiceKnown.value.size && !serves.size && !skips.size) return stops

    const boardServes = (s: RouteDetailStop) =>
      stopServiceKnown.value.has(s.stopId) &&
      (runningAtStops.value.get(s.stopId)?.has(routeId) ?? false)
    let first = stops.findIndex(boardServes)
    let last = -1
    for (let i = stops.length - 1; i >= 0; i--) {
      if (boardServes(stops[i])) { last = i; break }
    }
    // No board has confirmed the line anywhere yet — no span to bound
    // additions by, so alerts may fill in anywhere for now.
    if (first < 0) { first = 0; last = stops.length - 1 }

    const onPath = stops.filter((s, i) => {
      if (named(skips, s)) return false
      if (named(serves, s) && i >= first && i <= last && onOwnTrack(s)) return true
      return (
        !stopServiceKnown.value.has(s.stopId) ||
        (runningAtStops.value.get(s.stopId)?.has(routeId) ?? true)
      )
    })
    return onPath.length ? onPath : stops
  })

  /**
   * Whether the running path leaves some of the line's track uncovered —
   * an end cut short, or a branch not being run — as opposed to mere
   * middle skips, which a train passes over the same rails.
   *
   * The map switches renderers on this. Portolan's ribbon can only draw
   * the timetable's line, and this is precisely the timetable being wrong:
   * on parade day the Sunday schedule ran the 4 to New Lots while every
   * train turned at Utica, so the ribbon overshot the line's real end by
   * a branch.
   */
  const pathLeavesTrack = computed(() => {
    const all = routeStops.value
    const served = servedStops.value
    if (!all.length || served.length === all.length) return false
    const ids = new Set(served.map((s) => s.stopId))
    let lo = Infinity
    let hi = -Infinity
    for (const s of served) {
      if (s.distanceAlongRoute < lo) lo = s.distanceAlongRoute
      if (s.distanceAlongRoute > hi) hi = s.distanceAlongRoute
    }
    return all.some(
      (s) =>
        !ids.has(s.stopId) &&
        (!onOwnTrack(s) || s.distanceAlongRoute < lo || s.distanceAlongRoute > hi),
    )
  })

  /** Stops in display order (reversed for the second direction). */
  const displayStops = computed(() =>
    isReversed.value ? [...servedStops.value].reverse() : servedStops.value,
  )

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
        '/transit/route-detail',
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
    serviceFetchId++
    stopRunningRoutes.value = new Map()
    stopServiceKnown.value = new Set()
    alertOverrides.value = { serves: new Set(), skips: new Set() }
    feedOnestopId.value = null
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

  /**
   * Which lines are actually running at each stop, keyed by stop id.
   *
   * The same judgement the station header makes, from the same evidence: a
   * stop's departure board names the routes with a run inside its window,
   * and a line that calls here but is absent from it is not running now
   * (the 3 at Eastern Pkwy after the evening).
   *
   * ONE request for the whole line. Per-stop boards were one request each,
   * fired as the rider scrolled, so the bullets faded in a ragged cascade
   * down the list; the server fans out instead and answers once, and the
   * whole list settles together.
   *
   * A stop PRESENT with an empty set is known: upstream answered and named
   * nothing departing, which is what a station looks like once the lines
   * stop calling at it. A stop ABSENT could not be reached, and nothing is
   * claimed about it.
   */
  /** The feed's onestop id as the boards report it — the key portolan's
   *  stop index needs, which route detail itself does not carry. */
  const feedOnestopId = ref<string | null>(null)
  let serviceFetchId = 0

  async function loadStopService(feedId: string, stopIds: string[]) {
    if (!feedId || !stopIds.length) return
    const fetchId = ++serviceFetchId
    try {
      const { data } = await api.get<{
        running?: Record<string, string[]>
        feedOnestopId?: string
      }>('/transit/service-at-stops', {
        params: { feedId, stopIds: stopIds.join(',') },
      })
      // A route the rider has already navigated away from must not land.
      if (fetchId !== serviceFetchId) return
      const running = new Map<string, Set<string>>()
      const known = new Set<string>()
      for (const [stopId, ids] of Object.entries(data?.running ?? {})) {
        running.set(stopId, new Set(ids))
        known.add(stopId)
      }
      stopRunningRoutes.value = running
      stopServiceKnown.value = known
      if (data?.feedOnestopId) feedOnestopId.value = data.feedOnestopId
    } catch {
      // No answer — every stop stays unknown and nothing is dimmed.
    }
  }

  async function fetchTripStopTimes(feedId: string, tripId: string, forVehicleId: string) {
    const fetchId = tripStopFetchId
    try {
      const { data } = await api.get<{ stops: TripStopTime[] }>(
        '/transit/trip-stops',
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
      const vehicleData = await fetchVehiclesOnRoutes(
        activeRoute.value.feedId,
        routeIds,
        routeBounds,
      )

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
    routeStops,
    servedStops,
    pathLeavesTrack,
    displayStops,
    directionFilteredVehicleIds,
    selectedDirection,
    activeDirection,
    tripStopTimes,
    stopTimeMap,
    openRoute,
    closeRoute,
    stopRunningRoutes,
    stopServiceKnown,
    feedOnestopId,
    loadStopService,
    setAlertOverrides,
    setStopSkips,
    runningAtStops,
    selectVehicle,
    setDirection,
  }
})
