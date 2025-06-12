import { ref } from 'vue'
import { defineStore } from 'pinia'
import { Directions, TripsResponse } from '@/types/directions.types'
import { Waypoint } from '@/types/map.types'

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
  const selectedMode = ref('pedestrian')
  const isLoading = ref(false)

  // Track which trips are visible on the map
  const visibleTripIds = ref<Set<string>>(new Set())

  function setDirections(directions_: Directions) {
    directions.value = directions_
  }

  function setTrips(trips_: TripsResponse) {
    trips.value = trips_
    // When new trips are loaded, show all by default
    if (trips_) {
      visibleTripIds.value = new Set(trips_.trips.map(trip => trip.id))
    }
  }

  function unsetDirections() {
    directions.value = null
  }

  function unsetTrips() {
    trips.value = null
    visibleTripIds.value.clear()
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

  function toggleTripVisibility(tripId: string) {
    if (visibleTripIds.value.has(tripId)) {
      visibleTripIds.value.delete(tripId)
    } else {
      visibleTripIds.value.add(tripId)
    }
    // Create a new Set to trigger reactivity
    visibleTripIds.value = new Set(visibleTripIds.value)
  }

  function setTripVisibility(tripId: string, visible: boolean) {
    if (visible) {
      visibleTripIds.value.add(tripId)
    } else {
      visibleTripIds.value.delete(tripId)
    }
    // Create a new Set to trigger reactivity
    visibleTripIds.value = new Set(visibleTripIds.value)
  }

  function showAllTrips() {
    if (trips.value) {
      visibleTripIds.value = new Set(trips.value.trips.map(trip => trip.id))
    }
  }

  function hideAllTrips() {
    visibleTripIds.value.clear()
    visibleTripIds.value = new Set()
  }

  return {
    directions,
    trips,
    waypoints,
    selectedMode,
    isLoading,
    visibleTripIds,
    setDirections,
    setTrips,
    unsetDirections,
    unsetTrips,
    setWaypoint,
    setWaypoints,
    removeWaypoint,
    setLoading,
    toggleTripVisibility,
    setTripVisibility,
    showAllTrips,
    hideAllTrips,
  }
})
