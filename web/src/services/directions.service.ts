import { watch } from 'vue'
import { storeToRefs } from 'pinia'
import { api } from '@/lib/api'
import { createSharedComposable } from '@vueuse/core'
import { useDirectionsStore } from '@/stores/directions.store'
import { Waypoint } from '@/types/map.types'
import type { TripsRequest, TravelMode } from '@/types/directions.types'
import { WaypointType } from '@/types/directions.types'

const MIN_LOCATIONS = 2

// Available vehicle modes that users can select (walking is implicit via includeWalking)
const AVAILABLE_VEHICLES = ['car', 'bike']

// Map frontend mode selection to available vehicles
const MODE_TO_VEHICLES = {
  multi: ['car', 'bike'], // Multi-modal shows all vehicle options (walking is implicit)
  auto: ['car'],
  bicycle: ['bike'],
  pedestrian: [], // Pedestrian mode only uses walking (implicit)
  transit: [], // Transit fallback to walking for now (implicit)
}

function directionsService() {
  const directionsStore = useDirectionsStore()
  const { waypoints, selectedMode } = storeToRefs(directionsStore)

  async function getDirections() {
    const filteredWaypoints = waypoints.value.filter(wp => wp.lngLat != null)

    if (filteredWaypoints.length < MIN_LOCATIONS) {
      directionsStore.unsetTrips()
      return
    }

    directionsStore.setLoading(true)

    try {
      // Determine which vehicles to show based on selected mode
      const availableVehicles =
        MODE_TO_VEHICLES[selectedMode.value as keyof typeof MODE_TO_VEHICLES] ||
        AVAILABLE_VEHICLES

      // Build trips request
      const tripsRequest: TripsRequest = {
        waypoints: filteredWaypoints.map((waypoint, index) => ({
          id: `waypoint-${index}`,
          coordinate: {
            lat: waypoint.lngLat!.lat,
            lng: waypoint.lngLat!.lng,
          },
          type:
            index === 0 || index === filteredWaypoints.length - 1
              ? WaypointType.STOP
              : WaypointType.VIA,
          name: (waypoint as any).name,
        })),
        availableVehicles,
        maxOptions: 3,
        includeWalking: true,
        preferences: {
          optimize: 'time',
          alternatives: true,
        },
      }

      const { data: trips } = await api.post('/directions/trips', tripsRequest)
      directionsStore.setTrips(trips)
    } catch (error) {
      console.error('Error getting trips:', error)
      directionsStore.unsetTrips()
    } finally {
      directionsStore.setLoading(false)
    }
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

  watch(
    waypoints,
    () => {
      getDirections()
    },
    { deep: true },
  )

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
