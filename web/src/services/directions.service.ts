import { watch, ref, toRaw } from 'vue'
import axios from 'axios'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import { api } from '@/lib/api'
import { createSharedComposable } from '@vueuse/core'
import { useGeolocationService } from '@/services/geolocation.service'
import { useOrientationService } from '@/services/orientation.service'
import { startMotion } from '@/lib/directions/start-motion'
import { useDirectionsStore } from '@/stores/directions.store'
import { useNavigationPreferencesStore } from '@/stores/preferences/navigation-preferences.store'
import { TRIP_SORTS, type TripSort } from '@/lib/preferences/navigation-preferences'
import { Waypoint } from '@/types/map.types'
import { TripsResponse, WaypointType } from '@/types/directions.types'
import { LngLat } from 'mapbox-gl'
import type { Place } from '@/types/place.types'
import { useGeocodingService } from '@/services/geocoding.service'
import { getSearchResultName } from '@/lib/search/search-result'
import { useVehiclesStore } from '@/stores/vehicles.store'
import { usePlaceService } from '@/services/place/place.service'
import { constraintRequestFields } from '@/lib/directions/waypoint-time'
import { mapCandidate } from '@/lib/directions/trip-response'
import { withCuratedTripColors } from '@/services/layers/features/portolan/portolan-bullets'
import {
  serializeDirectionsQuery,
  parseDirectionsQuery,
  directionsQueryEquals,
  shareableWaypointId,
} from '@/lib/directions/directions-url'

const MIN_WAYPOINTS = 2
const CURRENT_LOCATION_ID = 'current-location'

function directionsService() {
  const store = useDirectionsStore()
  const { waypoints, selectedMode, sortPreference, effectiveSort, departureTime, routingPreferences } = storeToRefs(store)
  const { excludedModes } = storeToRefs(useNavigationPreferencesStore())

  const lastRequestKey = ref('')
  const isRequesting = ref(false)
  // Tracks the in-flight directions request so a newer one can abort it.
  const abortController = ref<AbortController | null>(null)

  const {
    coords,
    isSupported: isGeolocationSupported,
    resume,
  } = useGeolocationService()
  const orientation = useOrientationService()

  function currentMotion() {
    return startMotion({
      course: coords.value.heading,
      speed: coords.value.speed,
      compass: orientation.heading.value,
      compassAccuracy: orientation.headingAccuracy.value,
    })
  }

  /**
   * Generate unique key for request deduplication
   */
  function getRequestKey(wps: Waypoint[], mode: string, prefs: any): string {
    const coords = wps
      .filter(wp => wp.lngLat)
      .map(wp => `${wp.lngLat!.lat},${wp.lngLat!.lng}`)
      .join(';')
    return `${coords}|${mode}|${effectiveSort.value}|${excludedModes.value.join(',')}|${departureTime.value || ''}|${JSON.stringify(prefs)}`
  }

  /** Active vehicles whose location the user is happy to route from. */
  function collectAvailableVehicles() {
    if (routingPreferences.value.useKnownVehicleLocations === false) return []
    return useVehiclesStore().activeVehicles
      .filter((v) => v.lastKnownLocation)
      .map((v) => ({
        id: v.id,
        type: v.type,
        energyType: v.energyType ?? undefined,
        name: v.name ?? undefined,
        location: v.lastKnownLocation!,
      }))
  }

  /**
   * Build the API request for a run of waypoints.
   *
   * Uses getSearchResultName so reverse-geocoded map-clicks (which often have
   * no place.name but do have an address) still produce a useful label —
   * the same helper the waypoint input uses.
   */
  function buildTripRequest(wps: Waypoint[]) {
    return {
      waypoints: wps.map((wp, i) => ({
        location: { lat: wp.lngLat!.lat, lng: wp.lngLat!.lng },
        type:
          i === 0
            ? 'origin'
            : i === wps.length - 1
              ? 'destination'
              : 'via',
        label: wp.place ? getSearchResultName(wp.place as Place) : '',
        // Per-waypoint time constraints
        ...constraintRequestFields(wp.timeConstraint),
        ...(i === 0 && wp.place?.id === CURRENT_LOCATION_ID && currentMotion()),
      })),
      selectedMode: selectedMode.value,
      ...(effectiveSort.value !== 'balanced' && { sortPreference: effectiveSort.value }),
      excludedModes: excludedModes.value,
      availableVehicles: collectAvailableVehicles(),
      routingPreferences: routingPreferences.value,
      ...(departureTime.value && { preferredDepartureTime: departureTime.value }),
      requestId: `frontend-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    }
  }

  /**
   * Fetch directions from API.
   *
   * Any in-flight request is aborted before a new one starts. When the user
   * tweaks waypoints/mode/sort while trips are still loading, the stale
   * request must not win the race — otherwise its late response overwrites
   * (or, worse, the early-return guard suppressed) the results for the
   * inputs the user actually wants.
   *
   * `quiet` re-plans the same search in place: no spinner, no plan cache, and
   * the shown results survive a failure.
   */
  async function getDirections({ quiet = false } = {}) {
    refreshCurrentLocation()
    const validWaypoints = waypoints.value.filter(wp => wp.lngLat)

    // Need at least 2 waypoints — drop any in-flight request and clear.
    if (validWaypoints.length < MIN_WAYPOINTS) {
      abortController.value?.abort()
      abortController.value = null
      store.unsetTrips()
      lastRequestKey.value = ''
      isRequesting.value = false
      store.setLoading(false)
      return
    }

    const requestKey = getRequestKey(
      validWaypoints,
      selectedMode.value,
      routingPreferences.value,
    )

    // Identical to the request already in flight (or the last one resolved) —
    // nothing to do.
    if (!quiet && requestKey === lastRequestKey.value) return

    // Back from a trip's page: the list it left is still in the store. Show it
    // as is, and refresh it quietly once it's older than a leave-now plan lasts.
    if (!quiet && requestKey === store.plannedKey && store.trips) {
      lastRequestKey.value = requestKey
      if (!departureTime.value && Date.now() - store.plannedAt > LEAVE_NOW_CACHE_TTL_MS) void getDirections({ quiet: true })
      return
    }

    // Supersede any in-flight request: its inputs are now stale.
    abortController.value?.abort()
    const controller = new AbortController()
    abortController.value = controller

    lastRequestKey.value = requestKey
    isRequesting.value = true
    if (!quiet) store.setLoading(true)

    try {
      const request = buildTripRequest(validWaypoints)

      // Same inputs planned recently in this tab? Restore the exact
      // response (same trip ids and times) instead of re-planning — a page
      // refresh on a trip detail lands back on the identical trip.
      const planKey = planCacheKey(request)
      const cached = quiet ? null : readPlanCache(planKey, request.preferredDepartureTime ? PLAN_CACHE_TTL_MS : LEAVE_NOW_CACHE_TTL_MS)
      if (cached) {
        store.setTrips(cached)
        store.setPlanned(requestKey)
        void nameCurrentLocationOrigin(cached)
        return
      }

      const { data } = await api.post('/directions/', request, {
        signal: controller.signal,
        timeout: 30_000,
      })

      // Transform response to UI format
      const placeIds = validWaypoints.map(wp => shareableWaypointId(wp.place))
      const serverWaypoints: Array<{ label?: string }> = data.request?.waypoints ?? []
      const response: TripsResponse = {
        request: {
          waypoints: validWaypoints.map((wp, i) => {
            const place = wp.place
            return {
              id: `wp-${i}`,
              coordinate: { lat: wp.lngLat!.lat, lng: wp.lngLat!.lng },
              type:
                i === 0 || i === validWaypoints.length - 1
                  ? WaypointType.STOP
                  : WaypointType.VIA,
              name: (place ? getSearchResultName(place as Place) : '') || serverWaypoints[i]?.label || '',
              // Pass through the full Place for POI rendering in the trip timeline
              ...(place ? { place } : {}),
            }
          }),
          availableVehicles: request.availableVehicles.map(v => v.type),
          maxOptions: 5,
          includeWalking: true,
          preferences: { optimize: 'time', alternatives: true },
        },
        trips: await withCuratedTripColors(data.trips.map((c: any, i: number) => mapCandidate(c, i, placeIds))),
        earliestStart:
          data.trips[0]?.trip.earliestStartTime || new Date().toISOString(),
        latestEnd:
          data.trips[0]?.trip.latestEndTime ||
          new Date(Date.now() + 3600000).toISOString(),
        metadata: data.metadata,
      }

      store.setTrips(response, { keepSelection: quiet })
      store.setPlanned(requestKey)
      writePlanCache(planKey, response)
      void nameCurrentLocationOrigin(response)
    } catch (error) {
      // Aborted by a newer request — leave all state to that request.
      if (axios.isCancel(error)) return
      console.error('Failed to fetch directions:', error)
      if (!quiet) store.unsetTrips()
      lastRequestKey.value = '' // Allow retry
    } finally {
      // Only the request that is still current may clear the shared loading
      // flag — an aborted predecessor must not switch off the spinner for
      // the request that replaced it.
      if (abortController.value === controller) {
        isRequesting.value = false
        store.setLoading(false)
        abortController.value = null
      }
    }
  }

  /**
   * Names the point a current-location trip sets out from. "Current location"
   * follows the traveller; the trip's origin is where they stood when it was planned.
   */
  async function nameCurrentLocationOrigin(response: TripsResponse) {
    const origin = response.request.waypoints[0]
    if (origin?.place?.id !== CURRENT_LOCATION_ID) return
    const { lat, lng } = origin.coordinate
    const geocoded = await useGeocodingService()
      .reverseGeocode({ lat, lng, limit: 1 })
      .catch(() => null)
    const found = geocoded?.results[0]
    const planned = store.trips?.request
    if (!found || !planned || toRaw(planned) !== response.request) return
    const name = getSearchResultName(found)
    if (!name) return
    const entry = planned.waypoints[0]
    entry.name = name
    entry.place = { ...entry.place!, name: { value: name, sourceId: found.name?.sourceId ?? '' } }
  }

  /** Moves current-location waypoints to the latest fix. */
  function refreshCurrentLocation() {
    const fresh = getCurrentLocationWaypoint()?.lngLat
    if (!fresh) return
    waypoints.value.forEach((wp, index) => {
      if (wp.place?.id !== CURRENT_LOCATION_ID || !wp.lngLat) return
      if (wp.lngLat.lat === fresh.lat && wp.lngLat.lng === fresh.lng) return
      store.setWaypoint(index, getCurrentLocationWaypoint()!)
    })
  }

  // ── Plan cache (sessionStorage) ─────────────────────────────────────
  // One entry: the latest plan, keyed by its full request (minus volatile
  // fields). Survives refresh within the tab; cross-device sharing goes
  // through the URL → re-plan → trip-signature match path instead.
  const PLAN_CACHE_KEY = 'parchment:last-plan'
  const PLAN_CACHE_TTL_MS = 30 * 60_000
  /** A leave-now plan goes stale as its trains leave; past this, plan afresh. */
  const LEAVE_NOW_CACHE_TTL_MS = 2 * 60_000

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function planCacheKey(request: any): string {
    const { requestId: _id, availableVehicles: _v, ...stable } = request
    const waypoints = stable.waypoints.map(({ heading: _h, speed: _s, ...wp }: { heading?: number; speed?: number }) => wp)
    return JSON.stringify({ ...stable, waypoints })
  }

  function readPlanCache(key: string, ttlMs: number): TripsResponse | null {
    try {
      const raw = sessionStorage.getItem(PLAN_CACHE_KEY)
      if (!raw) return null
      const entry = JSON.parse(raw)
      if (entry.key !== key) return null
      if (Date.now() - entry.savedAt > ttlMs) return null
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
  /**
   * Fill in everything a waypoint's place record is missing.
   *
   * A waypoint arrives holding whatever the surface that set it happened to
   * know: an autocomplete row carries a name, coordinates and an icon; a
   * shared link carries a name and an id. The trip timeline and the map
   * markers render from that record, so a thin one shows a grey pin and a
   * bare name where the place has a category, hours and a rating. Look the
   * full record up in the background and swap it in — the place cache makes
   * a repeat lookup free.
   */
  /**
   * Ids already looked up. A waypoint's record is replaced by the lookup's
   * result, which triggers the watcher again — and the surfaces that set
   * waypoints do so on every keystroke-driven selection, so without this the
   * same place would be fetched over and over.
   */
  const hydratedPlaceIds = new Set<string>()

  async function hydrateWaypointPlace(index: number, placeId: string) {
    const { lookupPlaceById } = usePlaceService()
    const full = await lookupPlaceById(placeId)
    if (!full) return

    const current = waypoints.value[index]
    // The waypoint may have moved on while the lookup was in flight.
    if (current?.place?.id !== placeId) return

    // The waypoint's own coordinates win: the user picked that point, and a
    // POI's canonical centre can sit metres away from it.
    store.setWaypoint(index, { ...current, place: full })
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

  /** Drops the planned trip and its waypoints, and with them everything they draw on the map. */
  function clearTrip() {
    clearWaypoints()
    store.unsetTrips()
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
      id: CURRENT_LOCATION_ID,
      name: { value: 'Current location' },
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

  // Every surface that sets a waypoint — the picker, a map click, a shared
  // link, the place page's Directions button — routes through the store, so
  // hydration hangs off the store rather than off each of them remembering to
  // ask for it.
  watch(
    waypoints,
    wps => {
      wps.forEach((wp, index) => {
        const id = wp.place?.id
        if (!id || hydratedPlaceIds.has(id)) return
        hydratedPlaceIds.add(id)
        hydrateWaypointPlace(index, id)
      })
    },
    { deep: true, immediate: true },
  )

  /**
   * Keep the planned trip's stops pointing at the places the store now holds.
   *
   * A plan echoes back the waypoints it was built from, but a waypoint's place
   * record keeps improving after the fact — reverse geocoding a dropped pin,
   * looking up a stop restored from a link, filling in a thin autocomplete
   * row. Whether that lands before the plan, during it, or against a cached
   * plan restored whole, the trip has to end up rendering the record the user
   * would see anywhere else, without re-planning the route to get it.
   */
  watch(
    [waypoints, () => store.trips],
    () => {
      const planned = store.trips?.request?.waypoints
      if (!planned) return
      const settled = waypoints.value.filter(wp => wp.lngLat)
      planned.forEach((entry, i) => {
        const place = settled[i]?.place
        // A current-location stop keeps the name it was planned under.
        if (!place || entry.place === place || place.id === CURRENT_LOCATION_ID) return
        entry.place = place
        entry.name = getSearchResultName(place as Place)
      })
    },
    { deep: true, immediate: true },
  )

  // ── Shareable URL state ─────────────────────────────────────────────
  // Directions inputs live in the query string (?wp=lat,lng,label&mode=…)
  // so links can be bookmarked, shared, and reproduced exactly.
  const route = useRoute()
  const router = useRouter()

  /** Hydrate the store from a shared/bookmarked directions URL. */
  function applyUrlState(): boolean {
    const state = parseDirectionsQuery(route.query)
    if (!state) return false

    // A shared link carries a label and, where the waypoint had one, a place
    // id. The stub renders immediately; the id (when present) then fetches the
    // real record so a reloaded trip looks like the one that was planned.
    const wps = state.waypoints.map((w, i) => ({
      lngLat: new LngLat(w.lng, w.lat),
      place: w.label || w.id
        ? ({
            id: w.id || `shared-wp-${i}`,
            name: { value: w.label ?? '' },
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
    if (TRIP_SORTS.includes(state.sort as TripSort)) store.sortPreference = state.sort as TripSort
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
          id: shareableWaypointId(w.place),
        })),
      mode: selectedMode.value,
      sort: sortPreference.value || undefined,
      depart: departureTime.value || undefined,
    })
    if (directionsQueryEquals(q, route.query)) return
    const { wp: _wp, wpid: _wpid, mode: _mode, sort: _sort, depart: _depart, ...rest } = route.query
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
    [waypoints, selectedMode, effectiveSort, excludedModes, departureTime, routingPreferences],
    () => getDirections(),
    { deep: true, immediate: true },
  )

  // Request geolocation permissions early so current location is available
  if (isGeolocationSupported.value) {
    resume()
  }

  return {
    getDirections,
    replan: () => getDirections({ quiet: true }),
    refreshCurrentLocation,
    fillWaypoint,
    setWaypoint,
    setWaypoints,
    clearWaypoints,
    clearTrip,
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
