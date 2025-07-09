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
  const selectedTripId = ref<string | null>(null) // Track which trip is currently shown on map

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
    isLoading,
    selectedTripId,
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
