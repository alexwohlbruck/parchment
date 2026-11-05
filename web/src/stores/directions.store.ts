import { ref, computed, watch } from 'vue'
import { defineStore } from 'pinia'
import { Directions, TripsResponse } from '@/types/directions.types'
import { Waypoint } from '@/types/map.types'
import { RoutingPreferences, SelectedMode, TripView } from '@/types/multimodal.types'
import { getTimezoneWarning, type TimezoneWarning } from '@/lib/timezone-warning'
import type { ModeKey, TripSort } from '@/lib/preferences/navigation-preferences'
import { useNavigationPreferencesStore } from '@/stores/preferences/navigation-preferences.store'

// Rideshare has no working integration yet, so the mode is hidden everywhere it
// could be picked. Flip this to true to bring it back.
export const RIDESHARE_ENABLED = false

// Modes a user can actually select. A stored value outside this list — a mode
// since removed, or one currently hidden — falls back to 'multi' rather than
// being sent to the API, which rejects unknown modes.
export const SELECTABLE_MODES: readonly SelectedMode[] = [
  'multi',
  'walking',
  'driving',
  'biking',
  'transit',
  ...(RIDESHARE_ENABLED ? (['rideshare'] as const) : []),
]

export const useDirectionsStore = defineStore('directions', () => {
  const directions = ref<null | Directions>(null)
  const trips = ref<null | TripsResponse>(null)
  const waypoints = ref<Waypoint[]>([
    {
      lngLat: null,
    },
    {
      lngLat: null,
    },
  ]) // List of locations to get directions for

  const loadSelectedMode = (): SelectedMode => {
    const stored = localStorage.getItem('selectedMode') as SelectedMode | null
    return stored && SELECTABLE_MODES.includes(stored) ? stored : 'multi'
  }

  const selectedMode = ref<SelectedMode>(loadSelectedMode())

  const loadTripView = (): TripView =>
    localStorage.getItem('tripView') === 'list' ? 'list' : 'timeline'

  /** How suggestions are drawn: the time-scaled timeline, or a plain list. */
  const tripView = ref<TripView>(loadTripView())
  const navigationPreferences = useNavigationPreferencesStore()

  /** This search's own ranking; null follows the rider's default. */
  const sortPreference = ref<TripSort | null>(null)
  const effectiveSort = computed<TripSort>(
    () => sortPreference.value ?? navigationPreferences.sortPreference ?? 'balanced',
  )
  const departureTime = ref<string | null>(null) // ISO 8601 or null for "now"
  const isLoading = ref(false)
  const selectedTripId = ref<string | null>(null) // Track which trip is currently shown on map

  function modeKeyForSelected(m: SelectedMode): ModeKey {
    // 'multi' has no single mode — use biking's slice as the representative
    // request payload. Per-segment multi-mode prefs would need a backend change.
    return m === 'multi' ? 'biking' : (m as ModeKey)
  }

  const timezoneWarning = computed<TimezoneWarning | null>(() => {
    const destination = waypoints.value[waypoints.value.length - 1]
    if (!destination?.place?.timezone) return null
    const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone
    return getTimezoneWarning(userTz, destination.place.timezone)
  })

  // Flat merged view for the backend wire format and existing consumers.
  const routingPreferences = computed<RoutingPreferences>(() => {
    const mk = modeKeyForSelected(selectedMode.value)
    return {
      ...navigationPreferences.routing.general,
      ...navigationPreferences.routing.mode[mk],
    } as RoutingPreferences
  })

  // Watch and save selected mode to localStorage
  watch(selectedMode, newVal => {
    localStorage.setItem('selectedMode', newVal)
  })

  watch(tripView, newVal => {
    localStorage.setItem('tripView', newVal)
  })

  function setDirections(directions_: Directions) {
    directions.value = directions_
  }

  function setTrips(trips_: TripsResponse) {
    trips.value = trips_

    // Automatically select the first trip (recommended or first in list)
    if (trips_.trips.length > 0) {
      const firstTrip =
        trips_.trips.find(trip => trip.isRecommended) || trips_.trips[0]
      setSelectedTripId(firstTrip.id)
    }
  }

  function unsetDirections() {
    directions.value = null
  }

  function unsetTrips() {
    trips.value = null
    selectedTripId.value = null
  }

  function setSelectedTripId(tripId: string | null) {
    selectedTripId.value = tripId
  }

  function setWaypoint(index: number, waypoint: Waypoint) {
    if (index >= waypoints.value.length) {
      waypoints.value.push(waypoint)
    } else {
      waypoints.value[index] = waypoint
    }
  }

  function setWaypoints(waypoints_: Waypoint[]) {
    waypoints.value = waypoints_
  }

  function removeWaypoint(index: number) {
    waypoints.value.splice(index, 1)
  }

  function setLoading(loading: boolean) {
    isLoading.value = loading
  }

  return {
    directions,
    trips,
    waypoints,
    selectedMode,
    tripView,
    sortPreference,
    effectiveSort,
    departureTime,
    isLoading,
    selectedTripId,
    timezoneWarning,
    routingPreferences,
    setDirections,
    setTrips,
    unsetDirections,
    unsetTrips,
    setSelectedTripId,
    setWaypoint,
    setWaypoints,
    removeWaypoint,
    setLoading,
  }
})
