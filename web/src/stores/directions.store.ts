import { ref } from 'vue'
import { defineStore } from 'pinia'
import { Directions } from '@/types/directions.types'
import { Waypoint } from '@/types/map.types'

export const useDirectionsStore = defineStore('directions', () => {
  const directions = ref<null | Directions>(null)
  const waypoints = ref<Waypoint[]>([
    {
      lngLat: null,
    },
    {
      lngLat: null,
    },
  ]) // List of locations to get directions for
  const selectedMode = ref('pedestrian')

  function setDirections(directions_: Directions) {
    directions.value = directions_
  }

  function unsetDirections() {
    directions.value = null
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

  return {
    directions,
    waypoints,
    selectedMode,
    setDirections,
    unsetDirections,
    setWaypoint,
    setWaypoints,
    removeWaypoint,
  }
})
