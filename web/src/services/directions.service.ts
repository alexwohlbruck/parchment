import { watch, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import { api } from '@/lib/api'
import { createSharedComposable } from '@vueuse/core'
import { useGeolocationService } from '@/services/geolocation.service'
import { useDirectionsStore } from '@/stores/directions.store'
import { Waypoint } from '@/types/map.types'
import { TripsResponse, WaypointType } from '@/types/directions.types'
import { LngLat } from 'mapbox-gl'
import type { Place } from '@/types/place.types'
import { useGeocodingService } from './geocoding.service'
import { getSearchResultName } from '@/lib/search.utils'
import { useVehiclesStore } from '@/stores/vehicles.store'
import {
  serializeDirectionsQuery,
  parseDirectionsQuery,
  directionsQueryEquals,
} from '@/lib/directions-url'

const MIN_WAYPOINTS = 2

function directionsService() {
  const store = useDirectionsStore()
  const { waypoints, selectedMode, sortPreference, departureTime, routingPreferences } = storeToRefs(store)

  const lastRequestKey = ref('')
  const isRequesting = ref(false)

  const {
    coords,
    isSupported: isGeolocationSupported,
    resume,
  } = useGeolocationService()

  /**
   * Generate unique key for request deduplication
   */
  function getRequestKey(wps: Waypoint[], mode: string, prefs: any): string {
    const coords = wps
      .filter(wp => wp.lngLat)
      .map(wp => `${wp.lngLat!.lat},${wp.lngLat!.lng}`)
      .join(';')
    return `${coords}|${mode}|${sortPreference.value || ''}|${departureTime.value || ''}|${JSON.stringify(prefs)}`
  }

  /**
   * Fetch directions from API
   */
  async function getDirections() {
    const validWaypoints = waypoints.value.filter(wp => wp.lngLat)
    const requestKey = getRequestKey(
      validWaypoints,
      selectedMode.value,
      routingPreferences.value,
    )

    // Skip duplicate or concurrent requests
    if (requestKey === lastRequestKey.value || isRequesting.value) return

    // Need at least 2 waypoints
    if (validWaypoints.length < MIN_WAYPOINTS) {
      store.unsetTrips()
      lastRequestKey.value = ''
      return
    }

    lastRequestKey.value = requestKey
    isRequesting.value = true
    store.setLoading(true)

    try {
      // Send active vehicles with known locations from the user's vehicle store
      const useVehicleLocations =
        routingPreferences.value.useKnownVehicleLocations !== false

      const vehiclesStore = useVehiclesStore()
      const availableVehicles = useVehicleLocations
        ? vehiclesStore.activeVehicles
            .filter((v) => v.lastKnownLocation)
            .map((v) => ({
              id: v.id,
              type: v.type,
              energyType: v.energyType ?? undefined,
              name: v.name ?? undefined,
              location: v.lastKnownLocation!,
            }))
        : []

      // Build API request. Use getSearchResultName so reverse-geocoded
      // map-clicks (which often have no place.name but do have an address)
      // still produce a useful label — same helper the waypoint input uses.
      const request = {
        waypoints: validWaypoints.map((wp, i) => ({
          location: { lat: wp.lngLat!.lat, lng: wp.lngLat!.lng },
          type:
            i === 0
              ? 'origin'
              : i === validWaypoints.length - 1
                ? 'destination'
                : 'via',
          label: wp.place ? getSearchResultName(wp.place as Place) : '',
          // Per-waypoint time constraints
          ...(wp.timeConstraint?.mode === 'departAfter' && { departAfter: wp.timeConstraint.time }),
          ...(wp.timeConstraint?.mode === 'arriveBy' && { arriveBy: wp.timeConstraint.time }),
          ...(wp.timeConstraint?.dwellTime && { dwellTime: wp.timeConstraint.dwellTime }),
        })),
        selectedMode: selectedMode.value,
        ...(sortPreference.value && { sortPreference: sortPreference.value }),
        availableVehicles,
        routingPreferences: routingPreferences.value,
        ...(departureTime.value && { preferredDepartureTime: departureTime.value }),
        requestId: `frontend-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      }

      // Same inputs planned recently in this tab? Restore the exact
      // response (same trip ids and times) instead of re-planning — a page
      // refresh on a trip detail lands back on the identical trip.
      const planKey = planCacheKey(request)
      const cached = readPlanCache(planKey)
      if (cached) {
        store.setTrips(cached)
        return
      }

      const { data } = await api.post('/directions/', request)

      // Transform response to UI format
      const serverWaypoints: Array<{ label?: string }> = data.request?.waypoints ?? []
      const response: TripsResponse = {
        request: {
          waypoints: validWaypoints.map((wp, i) => ({
            id: `wp-${i}`,
            coordinate: { lat: wp.lngLat!.lat, lng: wp.lngLat!.lng },
            type:
              i === 0 || i === validWaypoints.length - 1
                ? WaypointType.STOP
                : WaypointType.VIA,
            name: (wp.place ? getSearchResultName(wp.place as Place) : '') || serverWaypoints[i]?.label || '',
            // Pass through the full Place for POI rendering in the trip timeline
            ...(wp.place ? { place: wp.place } : {}),
          })),
          availableVehicles: availableVehicles.map(v => v.type),
          maxOptions: 5,
          includeWalking: true,
          preferences: { optimize: 'time', alternatives: true },
        },
        trips: data.trips.map((candidate: any, idx: number) => ({
          id: `${candidate.trip.requestId || `trip-${Date.now()}`}-${idx}`,
          mode: normalizeMode(candidate.trip.segments[0]?.mode || 'walking'),
          vehicleType: candidate.trip.segments[0]?.vehicle?.type || 'walking',
          summary: {
            totalDuration: candidate.trip.tripStats.totalDuration,
            totalDistance: candidate.trip.tripStats.totalDistance,
            hasTolls: false,
            hasHighways: false,
            hasFerries: false,
          },
          segments: flattenSegments(candidate.trip.segments),
          startTime: new Date(candidate.trip.earliestStartTime),
          endTime: new Date(candidate.trip.latestEndTime),
          isRecommended: candidate.rank === 1,
          rank: candidate.rank,
          provider: 'multimodal',
          cost: candidate.trip.tripStats.totalCost
            ? { total: { amount: candidate.trip.tripStats.totalCost.value, currency: candidate.trip.tripStats.totalCost.currency } }
            : undefined,
          co2Emissions: candidate.trip.tripStats.totalCo2 ?? undefined,
        })),
        earliestStart:
          data.trips[0]?.trip.earliestStartTime || new Date().toISOString(),
        latestEnd:
          data.trips[0]?.trip.latestEndTime ||
          new Date(Date.now() + 3600000).toISOString(),
        metadata: data.metadata,
      }

      store.setTrips(response)
      writePlanCache(planKey, response)
    } catch (error) {
      console.error('Failed to fetch directions:', error)
      store.unsetTrips()
      lastRequestKey.value = '' // Allow retry
    } finally {
      isRequesting.value = false
      store.setLoading(false)
    }
  }

  // ── Plan cache (sessionStorage) ─────────────────────────────────────
  // One entry: the latest plan, keyed by its full request (minus volatile
  // fields). Survives refresh within the tab; cross-device sharing goes
  // through the URL → re-plan → trip-signature match path instead.
  const PLAN_CACHE_KEY = 'parchment:last-plan'
  const PLAN_CACHE_TTL_MS = 30 * 60_000

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function planCacheKey(request: any): string {
    const { requestId: _id, availableVehicles: _v, ...stable } = request
    return JSON.stringify(stable)
  }

  function readPlanCache(key: string): TripsResponse | null {
    try {
      const raw = sessionStorage.getItem(PLAN_CACHE_KEY)
      if (!raw) return null
      const entry = JSON.parse(raw)
      if (entry.key !== key) return null
      if (Date.now() - entry.savedAt > PLAN_CACHE_TTL_MS) return null
      return entry.response as TripsResponse
    } catch {
      return null
    }
  }

  function writePlanCache(key: string, response: TripsResponse) {
    try {
      sessionStorage.setItem(
        PLAN_CACHE_KEY,
        JSON.stringify({ key, savedAt: Date.now(), response }),
      )
    } catch {
      // Quota exceeded or storage unavailable — the URL re-plan path
      // still recovers the trip, just without identical ids.
    }
  }

  /**
   * Normalize mode names from backend to frontend
   */
  function normalizeMode(mode: string): string {
    const map: Record<string, string> = {
      biking: 'cycling',
      walking: 'walking',
      driving: 'driving',
      transit: 'transit',
    }
    return map[mode] || mode
  }

  /**
   * Extract transit-specific fields from a segment's transitDetails.
   * Returns an object with lineName, lineColor, headsign, etc. —
   * or empty object if not a transit segment.
   */
  function extractTransitFields(seg: any) {
    const td = seg.details?.transitDetails
    if (!td) return {}
    return {
      lineName: td.shortName || td.route?.shortName,
      lineColor: td.color || td.route?.color,
      lineTextColor: td.textColor || td.route?.textColor,
      lineLongName: td.route?.longName,
      headsign: td.headsign || td.trip?.headsign,
      vehicleNumber: td.shortName || td.route?.shortName,
      agencyName: td.route?.agency?.name,
      agencyId: td.route?.agency?.id,
      routeType: td.route?.type,
      tripId: td.trip?.id,
      departureStop: td.departureStop,
      arrivalStop: td.arrivalStop,
      intermediateStops: td.stops?.slice(1, -1), // exclude first/last
      realTimeData: td.realTimeData,
      delay: td.delay,
      transitDetails: td,
    }
  }

  /**
   * Map a single raw backend segment to the flattened UI format.
   */
  function mapSegment(seg: any, id: string, legIndex: number) {
    return {
      id,
      type: 'route',
      legIndex,
      mode: normalizeMode(seg.mode),
      vehicleType: seg.vehicle?.type || seg.mode,
      startTime: new Date(seg.startTime),
      endTime: new Date(seg.endTime),
      duration: seg.duration,
      distance: seg.distance,
      waitSeconds: seg.waitSeconds,
      geometry: seg.geometry,
      instructions: seg.instructions,
      totalElevationGain: seg.totalElevationGain,
      totalElevationLoss: seg.totalElevationLoss,
      maxElevation: seg.maxElevation,
      minElevation: seg.minElevation,
      edgeSegments: seg.edgeSegments,
      start: seg.start,
      end: seg.end,
      ownership: seg.ownership ?? 'personal',
      carryingVehicle: seg.carryingVehicle ?? false,
      rideshareDetails: seg.details?.rideshareDetails ?? null,
      sharedMobilityDetails: seg.details?.sharedMobilityDetails ?? null,
      stationEntrance: seg.stationEntrance ?? null,
      ...extractTransitFields(seg),
    }
  }

  /**
   * Flatten multimodal segments into single array.
   * Transit segments get extra fields (lineName, lineColor, stops, etc.).
   */
  function flattenSegments(segments: any[]): any[] {
    return segments.flatMap(segment => {
      if (segment.details?.multimodalSegments) {
        return segment.details.multimodalSegments.map(
          (seg: any, i: number) =>
            mapSegment(
              seg,
              `segment-${segment.segmentIndex}-${i}`,
              seg.legIndex ?? segment.legIndex ?? 0,
            ),
        )
      }

      return [
        mapSegment(
          segment,
          `segment-${segment.segmentIndex}`,
          segment.legIndex ?? 0,
        ),
      ]
    })
  }

  /**
   * Helper function to set a waypoint and reverse geocode if needed
   * This ensures consistent behavior across all waypoint-setting functions
   */
  async function setWaypointWithGeocoding(index: number, waypoint: Waypoint) {
    // Immediately set the waypoint with coordinates (for instant feedback)
    store.setWaypoint(index, waypoint)
    
    // If waypoint has coordinates but no place info (e.g., from map click),
    // try to reverse geocode to get address information in the background
    if (waypoint.lngLat && !waypoint.place) {
      console.log('[Directions] Reverse geocoding waypoint at', waypoint.lngLat)
      
      // Reverse geocode in the background
      const geocodingService = useGeocodingService()
      geocodingService.reverseGeocode({
        lat: waypoint.lngLat.lat,
        lng: waypoint.lngLat.lng,
        limit: 1,
      }).then(result => {
        // If we got a result, update the waypoint with place info
        if (result.results && result.results.length > 0) {
          const place = result.results[0]
          console.log('[Directions] Reverse geocoding successful:', {
            name: place.name?.value,
            address: place.address?.value,
          })
          
          // Update the waypoint with the geocoded place info
          const updatedWaypoint = {
            ...waypoints.value[index],
            place: place,
          }
          store.setWaypoint(index, updatedWaypoint)

          // Patch the stored trip response if it already exists
          const trips = store.trips
          if (trips?.request?.waypoints?.[index]) {
            trips.request.waypoints[index].name = getSearchResultName(place as Place)
          }
        } else {
          console.log('[Directions] No reverse geocoding results found')
        }
      }).catch(error => {
        console.error('[Directions] Failed to reverse geocode waypoint:', error)
        // Continue without place info if geocoding fails
      })
    } else if (waypoint.place) {
      console.log('[Directions] Waypoint already has place info:', waypoint.place.name?.value)
    }
  }

  // Waypoint management
  async function fillWaypoint(waypoint: Waypoint) {
    const emptyIndex = waypoints.value.findIndex(wp => !wp.lngLat)
    const targetIndex = emptyIndex !== -1 ? emptyIndex : waypoints.value.length
    await setWaypointWithGeocoding(targetIndex, waypoint)
  }

  function setWaypoint(index: number, waypoint: Waypoint) {
    store.setWaypoint(index, waypoint)
  }

  /**
   * Move an existing waypoint to a new location (e.g. from dragging its
   * marker on the map). Clears prior place info so we reverse-geocode the new
   * coordinates. Safe to call with an out-of-range index — it's a no-op.
   */
  async function moveWaypoint(
    index: number,
    lngLat: { lng: number; lat: number },
  ) {
    if (index < 0 || index >= waypoints.value.length) return
    await setWaypointWithGeocoding(index, {
      lngLat: new LngLat(lngLat.lng, lngLat.lat),
      place: null,
    })
  }

  function setWaypoints(wps: Waypoint[]) {
    store.setWaypoints(wps)
  }

  function clearWaypoints() {
    store.setWaypoints([{ lngLat: null }, { lngLat: null }] as Waypoint[])
  }

  function removeWaypoint(index: number) {
    if (waypoints.value.length <= MIN_WAYPOINTS) {
      store.setWaypoint(index, { ...waypoints.value[index], lngLat: null })
    } else {
      store.removeWaypoint(index)
    }
  }

  function addWaypoint(waypoint?: Waypoint) {
    store.setWaypoint(waypoints.value.length, waypoint || { lngLat: null })
  }

  async function directionsFrom(waypoint: Waypoint) {
    await setWaypointWithGeocoding(0, waypoint)
  }

  /**
   * Get current location as a waypoint
   * Returns null if geolocation is not supported or not available
   */
  function getCurrentLocationWaypoint(): Waypoint | null {
    if (
      !isGeolocationSupported.value ||
      !coords.value.latitude ||
      !coords.value.longitude ||
      coords.value.latitude === Infinity ||
      coords.value.longitude === Infinity
    ) {
      return null
    }

    const currentLocationPlace: Place = {
      id: 'current-location',
      name: { value: 'Current Location' },
      geometry: {
        value: {
          type: 'point',
          center: {
            lat: coords.value.latitude,
            lng: coords.value.longitude,
          },
        },
      },
      externalIds: {},
      address: null,
      placeType: { value: 'current_location' },
    } as Place

    return {
      lngLat: new LngLat(coords.value.longitude, coords.value.latitude),
      place: currentLocationPlace,
    }
  }

  /**
   * Populate the origin (first waypoint) with current location
   * This is useful when clicking "Directions" buttons to automatically set the starting point
   */
  function populateOriginWithCurrentLocation() {
    const currentLocation = getCurrentLocationWaypoint()
    if (currentLocation) {
      store.setWaypoint(0, currentLocation)
    }
  }

  /**
   * Set up directions with current location as origin and destination waypoint
   * Only populates the first waypoint with current location if it's empty
   */
  async function directionsTo(waypoint: Waypoint) {
    // Only populate origin if it's empty
    if (!waypoints.value[0]?.lngLat) {
      populateOriginWithCurrentLocation()
    }
    await setWaypointWithGeocoding(1, waypoint)
  }

  // ── Shareable URL state ─────────────────────────────────────────────
  // Directions inputs live in the query string (?wp=lat,lng,label&mode=…)
  // so links can be bookmarked, shared, and reproduced exactly.
  const route = useRoute()
  const router = useRouter()

  /** Hydrate the store from a shared/bookmarked directions URL. */
  function applyUrlState(): boolean {
    const state = parseDirectionsQuery(route.query)
    if (!state) return false

    const wps = state.waypoints.map((w, i) => ({
      lngLat: new LngLat(w.lng, w.lat),
      place: w.label
        ? ({
            id: `shared-wp-${i}`,
            name: { value: w.label },
            geometry: {
              value: { type: 'point', center: { lat: w.lat, lng: w.lng } },
            },
            externalIds: {},
            address: null,
            placeType: { value: 'shared_location' },
          } as unknown as Place)
        : null,
    })) as Waypoint[]
    while (wps.length < MIN_WAYPOINTS) wps.push({ lngLat: null } as Waypoint)

    if (state.mode) store.selectedMode = state.mode as typeof selectedMode.value
    if (state.sort) store.sortPreference = state.sort as typeof sortPreference.value
    if (state.depart) store.departureTime = state.depart
    store.setWaypoints(wps)
    return true
  }

  /** Reflect the current inputs into the URL (replace — no history spam). */
  function syncUrl() {
    if (!route.path.startsWith('/directions')) return
    const q = serializeDirectionsQuery({
      waypoints: waypoints.value
        .filter((w) => w.lngLat)
        .map((w) => ({
          lat: w.lngLat!.lat,
          lng: w.lngLat!.lng,
          label: (w.place ? getSearchResultName(w.place as Place) : '') || undefined,
        })),
      mode: selectedMode.value,
      sort: sortPreference.value || undefined,
      depart: departureTime.value || undefined,
    })
    if (directionsQueryEquals(q, route.query)) return
    const { wp: _wp, mode: _mode, sort: _sort, depart: _depart, ...rest } = route.query
    router.replace({ query: { ...rest, ...q } }).catch(() => {})
  }

  applyUrlState()
  watch([waypoints, selectedMode, sortPreference, departureTime], syncUrl, {
    deep: true,
  })

  // Auto-fetch when waypoints, mode, preferences, sort, or departure time
  // change. `immediate` matters: applyUrlState() above hydrates the store
  // BEFORE this watcher registers, so a page refresh with URL params would
  // otherwise restore the inputs without ever planning — watchers don't
  // see mutations that precede them. The immediate run plans from the
  // hydrated state (and no-ops harmlessly when fewer than 2 waypoints).
  watch(
    [waypoints, selectedMode, sortPreference, departureTime, routingPreferences],
    getDirections,
    { deep: true, immediate: true },
  )

  // Request geolocation permissions early so current location is available
  if (isGeolocationSupported.value) {
    resume()
  }

  return {
    getDirections,
    fillWaypoint,
    setWaypoint,
    setWaypoints,
    clearWaypoints,
    removeWaypoint,
    addWaypoint,
    moveWaypoint,
    directionsFrom,
    directionsTo,
    getCurrentLocationWaypoint,
    populateOriginWithCurrentLocation,
  }
}

export const useDirectionsService = createSharedComposable(directionsService)
