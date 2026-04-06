import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { useStorage } from '@vueuse/core'
import { Directions, TripsResponse } from '@/types/directions.types'
import { Waypoint } from '@/types/map.types'
import { RoutingPreferences, SelectedMode } from '@/types/multimodal.types'
import { STORAGE_KEYS, jsonSerializer } from '@/lib/storage'

interface DirectionsState {
  mode: SelectedMode
  preferences: RoutingPreferences
  preferencesTab: string
}

const defaultPreferences: RoutingPreferences = {
  avoidHighways: false,
  avoidTolls: false,
  preferHOV: false,
  avoidFerries: false,
  preferLitPaths: false,
  preferPavedPaths: false,
  avoidHills: false,
  safetyVsEfficiency: 0.5,
  maxWalkingDistance: 1000,
  maxTransfers: 3,
  wheelchairAccessible: false,
  useKnownVehicleLocations: true,
  useKnownParkingLocations: true,
}

export const useDirectionsStore = defineStore('directions', () => {
  const stored = useStorage<DirectionsState>(
    STORAGE_KEYS.DIRECTIONS,
    {
      mode: 'multi',
      preferences: defaultPreferences,
      preferencesTab: 'walking',
    },
    undefined,
    { serializer: jsonSerializer },
  )

  const directions = ref<null | Directions>(null)
  const trips = ref<null | TripsResponse>(null)
  const waypoints = ref<Waypoint[]>([
    { lngLat: null },
    { lngLat: null },
  ])

  const selectedMode = computed({
    get: () => stored.value.mode,
    set: (v: SelectedMode) => { stored.value.mode = v },
  })

  const routingPreferences = computed({
    get: () => ({ ...defaultPreferences, ...stored.value.preferences }),
    set: (v: RoutingPreferences) => { stored.value.preferences = v },
  })

  const preferencesTab = computed({
    get: () => stored.value.preferencesTab,
    set: (v: string) => { stored.value.preferencesTab = v },
  })

  const isLoading = ref(false)
  const selectedTripId = ref<string | null>(null)

  function setDirections(directions_: Directions) {
    directions.value = directions_
  }

  function setTrips(trips_: TripsResponse) {
    trips.value = trips_

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

  function setRoutingPreferences(preferences: RoutingPreferences) {
    routingPreferences.value = preferences
  }

  return {
    directions,
    trips,
    waypoints,
    selectedMode,
    isLoading,
    selectedTripId,
    routingPreferences,
    preferencesTab,
    setDirections,
    setTrips,
    unsetDirections,
    unsetTrips,
    setSelectedTripId,
    setWaypoint,
    setWaypoints,
    removeWaypoint,
    setLoading,
    setRoutingPreferences,
  }
})
