import { ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { Directions, TripsResponse } from '@/types/directions.types'
import { Waypoint } from '@/types/map.types'
import { RoutingPreferences, SelectedMode } from '@/types/multimodal.types'

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

  const defaultPreferences: RoutingPreferences = {
    // Range preferences — 0.5 is neutral for most
    highways: 0.5,
    tolls: 0.5,
    ferries: 0.5,
    hills: 0.5,
    surfaceQuality: 0.25,
    litPaths: 0,
    safetyVsSpeed: 0.5,

    // Boolean preferences
    shortest: false,
    preferHOV: false,
    wheelchairAccessible: false,

    // Numeric/enum preferences (undefined = use engine default)
    cyclingSpeed: undefined,
    walkingSpeed: undefined,
    bicycleType: undefined,

    // Transit
    maxWalkingDistance: 1000,
    maxTransfers: 3,

    // UI state
    useKnownVehicleLocations: true,
    useKnownParkingLocations: true,
  }

  // Load from localStorage with defaults merged
  const loadPreferences = (): RoutingPreferences => {
    const stored = localStorage.getItem('routingPreferences')
    if (stored) {
      try {
        const parsed = JSON.parse(stored)
        return { ...defaultPreferences, ...parsed }
      } catch {
        return defaultPreferences
      }
    }
    return defaultPreferences
  }

  const routingPreferences = ref<RoutingPreferences>(loadPreferences())

  // Watch and save routing preferences to localStorage
  watch(
    routingPreferences,
    newVal => {
      localStorage.setItem('routingPreferences', JSON.stringify(newVal))
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
