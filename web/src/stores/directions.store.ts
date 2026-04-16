import { ref, computed, watch } from 'vue'
import { defineStore } from 'pinia'
import { Directions, TripsResponse } from '@/types/directions.types'
import { Waypoint } from '@/types/map.types'
import { RoutingPreferences, SelectedMode } from '@/types/multimodal.types'

// Mode-scoped preference storage
export type ModeKey = 'walking' | 'biking' | 'driving' | 'transit' | 'wheelchair'

// Keys that are shared across all modes — everything else is per-mode
const GENERAL_KEYS: ReadonlyArray<keyof RoutingPreferences> = [
  'ferries',
  'routingEngine',
  'useKnownVehicleLocations',
  'useKnownParkingLocations',
  'customModelOverride',
]

const GENERAL_KEY_SET = new Set<string>(GENERAL_KEYS as unknown as string[])

const defaultGeneralPreferences: Partial<RoutingPreferences> = {
  ferries: 0.5,
  useKnownVehicleLocations: true,
  useKnownParkingLocations: true,
}

const defaultModePreferences: Record<ModeKey, Partial<RoutingPreferences>> = {
  walking: {
    hills: 0.5,
    litPaths: 0,
    walkingSpeed: undefined,
  },
  biking: {
    hills: 0.5,
    surfaceQuality: 0.25,
    safetyVsSpeed: 0.5,
    cyclingSpeed: undefined,
    bicycleType: undefined,
  },
  driving: {
    highways: 0.5,
    tolls: 0.5,
    preferHOV: false,
    shortest: false,
  },
  transit: {
    maxWalkingDistance: 1000,
    maxTransfers: 3,
    wheelchairAccessible: false,
  },
  wheelchair: {
    hills: 0,
    surfaceQuality: 0.75,
    walkingSpeed: undefined,
    wheelchairAccessible: true,
  },
}

function cloneDefaults() {
  return {
    general: { ...defaultGeneralPreferences },
    mode: Object.fromEntries(
      (Object.keys(defaultModePreferences) as ModeKey[]).map(k => [
        k,
        { ...defaultModePreferences[k] },
      ]),
    ) as Record<ModeKey, Partial<RoutingPreferences>>,
  }
}

function loadPreferences(): {
  general: Partial<RoutingPreferences>
  mode: Record<ModeKey, Partial<RoutingPreferences>>
} {
  const defaults = cloneDefaults()
  const stored = localStorage.getItem('routingPreferences')
  if (!stored) return defaults

  try {
    const parsed = JSON.parse(stored)

    // New structured format: { general, mode }
    if (parsed && parsed.general && parsed.mode) {
      const general = { ...defaults.general, ...parsed.general }
      const mode = defaults.mode
      for (const k of Object.keys(mode) as ModeKey[]) {
        mode[k] = { ...mode[k], ...(parsed.mode[k] || {}) }
      }
      return { general, mode }
    }

    // Legacy flat format: migrate. General keys go to general; mode-specific
    // keys get applied to every mode (best-effort — user will re-tune per mode).
    if (parsed && typeof parsed === 'object') {
      const general: Partial<RoutingPreferences> = { ...defaults.general }
      const mode = defaults.mode
      for (const [k, v] of Object.entries(parsed)) {
        if (GENERAL_KEY_SET.has(k)) {
          ;(general as any)[k] = v
        } else {
          for (const mk of Object.keys(mode) as ModeKey[]) {
            ;(mode[mk] as any)[k] = v
          }
        }
      }
      return { general, mode }
    }
  } catch {
    // fall through to defaults
  }
  return defaults
}

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

  // Load selected mode from localStorage, default to 'multi'
  const loadSelectedMode = (): SelectedMode => {
    const stored = localStorage.getItem('selectedMode')
    if (stored) {
      try {
        return stored as SelectedMode
      } catch {
        return 'multi'
      }
    }
    return 'multi'
  }

  const selectedMode = ref<SelectedMode>(loadSelectedMode())
  const isLoading = ref(false)
  const selectedTripId = ref<string | null>(null) // Track which trip is currently shown on map

  const loaded = loadPreferences()
  const generalPreferences = ref<Partial<RoutingPreferences>>(loaded.general)
  const modePreferences = ref<Record<ModeKey, Partial<RoutingPreferences>>>(
    loaded.mode,
  )

  function modeKeyForSelected(m: SelectedMode): ModeKey {
    // 'multi' has no single mode — use biking's slice as the representative
    // request payload. Per-segment multi-mode prefs would need a backend change.
    return m === 'multi' ? 'biking' : (m as ModeKey)
  }

  // Flat merged view for the backend wire format and existing consumers.
  const routingPreferences = computed<RoutingPreferences>(() => {
    const mk = modeKeyForSelected(selectedMode.value)
    return {
      ...generalPreferences.value,
      ...(modePreferences.value[mk] || {}),
    } as RoutingPreferences
  })

  // Persist split structure to localStorage
  watch(
    [generalPreferences, modePreferences],
    () => {
      localStorage.setItem(
        'routingPreferences',
        JSON.stringify({
          general: generalPreferences.value,
          mode: modePreferences.value,
        }),
      )
    },
    { deep: true },
  )

  // Watch and save selected mode to localStorage
  watch(selectedMode, newVal => {
    localStorage.setItem('selectedMode', newVal)
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

  /**
   * Set a single general preference (shared across all modes).
   */
  function setGeneralPreference<K extends keyof RoutingPreferences>(
    key: K,
    value: RoutingPreferences[K],
  ) {
    generalPreferences.value = { ...generalPreferences.value, [key]: value }
  }

  /**
   * Set a single mode-scoped preference on the given mode.
   */
  function setModePreference<K extends keyof RoutingPreferences>(
    mode: ModeKey,
    key: K,
    value: RoutingPreferences[K],
  ) {
    modePreferences.value = {
      ...modePreferences.value,
      [mode]: { ...modePreferences.value[mode], [key]: value },
    }
  }

  return {
    directions,
    trips,
    waypoints,
    selectedMode,
    isLoading,
    selectedTripId,
    generalPreferences,
    modePreferences,
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
    setGeneralPreference,
    setModePreference,
  }
})

// Re-export keys/set so components can share the classification
export { GENERAL_KEYS, GENERAL_KEY_SET }
