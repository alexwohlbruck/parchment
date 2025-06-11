import { watch } from 'vue'
import { storeToRefs } from 'pinia'
import { api } from '@/lib/api'
import { createSharedComposable } from '@vueuse/core'
import { useDirectionsStore } from '@/stores/directions.store'
import { Waypoint } from '@/types/map.types'

const MIN_LOCATIONS = 2

function directionsService() {
  const directionsStore = useDirectionsStore()
  const { waypoints, selectedMode } = storeToRefs(directionsStore)

  async function getDirections() {
    const filteredWaypoints = waypoints.value.filter(wp => wp.lngLat != null)

    if (filteredWaypoints.length < MIN_LOCATIONS) {
      return
    }

    const { data: directions } = await api.post('/directions', {
      locations: filteredWaypoints.map(location => ({
        type: 'coordinates',
        value: [location.lngLat!.lat, location.lngLat!.lng],
      })),
      costing: selectedMode.value,
    })

    directionsStore.setDirections(directions)
  }

  function createBlankWaypoint() {
    return {
      lngLat: null,
    }
  }

  // Fill a new waypoint into an available slot
  function fillWaypoint(waypoint: Waypoint) {
    const emptyIndex = waypoints.value.findIndex(wp => wp.lngLat === null)
    if (emptyIndex !== -1) {
      directionsStore.setWaypoint(emptyIndex, waypoint)
    } else {
      directionsStore.setWaypoint(waypoints.value.length, waypoint)
    }
  }

  function setWaypoint(index: number, waypoint: Waypoint) {
    directionsStore.setWaypoint(index, waypoint)
  }

  function setWaypoints(waypoints: Waypoint[]) {
    directionsStore.setWaypoints(waypoints)
  }

  function removeWaypoint(index: number) {
    // Only prevent removal if we would have fewer than minimum locations
    if (waypoints.value.length <= MIN_LOCATIONS) {
      // If we're at minimum waypoints, clear the waypoint instead of removing it
      directionsStore.setWaypoint(index, {
        ...waypoints.value[index],
        lngLat: null,
      })
    } else {
      // We have more than minimum waypoints, safe to remove
      directionsStore.removeWaypoint(index)
    }
  }

  function addWaypoint(waypoint?: Waypoint) {
    const newWaypoint = waypoint || createBlankWaypoint()
    directionsStore.setWaypoint(waypoints.value.length, newWaypoint)
  }

  async function directionsFrom(waypoint: Waypoint) {
    directionsStore.setWaypoint(0, waypoint)
  }

  async function directionsTo(waypoint: Waypoint) {
    directionsStore.setWaypoint(1, waypoint)
  }

  watch(selectedMode, () => {
    getDirections()
  })

  watch(waypoints, () => {
    getDirections()
  })

  return {
    getDirections,
    createBlankWaypoint,
    fillWaypoint,
    setWaypoint,
    setWaypoints,
    removeWaypoint,
    addWaypoint,
    directionsFrom,
    directionsTo,
  }
}

export const useDirectionsService = createSharedComposable(directionsService)
