import { watch, nextTick, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { api } from '@/lib/api'
import { createSharedComposable } from '@vueuse/core'
import { useDirectionsStore } from '@/stores/directions.store'
import { Waypoint } from '@/types/map.types'
import { TripsResponse, WaypointType } from '@/types/directions.types'

const MIN_LOCATIONS = 2

// TODO: Remove this hardcoded data before committing - it is sensitive
// Hardcoded vehicle locations for testing multimodality
const HARDCODED_VEHICLE_LOCATIONS = {
  car: {
    lat: 35.21712207929376,
    lng: -80.81946433041882,
  },
  bike: {
    lat: 35.21700938703438,
    lng: -80.81994398107717,
  },
}

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

  // Track the last request to prevent duplicates
  const lastRequestKey = ref<string>('')
  const isRequestInProgress = ref(false)

  function generateRequestKey(waypoints: Waypoint[], mode: string): string {
    const waypointKey = waypoints
      .filter(wp => wp.lngLat != null)
      .map(wp => `${wp.lngLat!.lat},${wp.lngLat!.lng}`)
      .join(';')
    return `${waypointKey}|${mode}`
  }

  async function getDirections() {
    const filteredWaypoints = waypoints.value.filter(wp => wp.lngLat != null)
    const currentRequestKey = generateRequestKey(
      filteredWaypoints,
      selectedMode.value,
    )

    console.log(
      'getDirections called with waypoints:',
      filteredWaypoints.length,
      'mode:',
      selectedMode.value,
    )

    // Skip if this is the same request as last time or if a request is already in progress
    if (
      currentRequestKey === lastRequestKey.value ||
      isRequestInProgress.value
    ) {
      console.log(
        'Skipping duplicate or concurrent request:',
        currentRequestKey,
      )
      return
    }

    if (filteredWaypoints.length < MIN_LOCATIONS) {
      directionsStore.unsetTrips()
      lastRequestKey.value = ''
      return
    }

    lastRequestKey.value = currentRequestKey
    isRequestInProgress.value = true
    directionsStore.setLoading(true)

    try {
      // Determine which vehicles to show based on selected mode
      const availableVehicles =
        MODE_TO_VEHICLES[selectedMode.value as keyof typeof MODE_TO_VEHICLES] ||
        AVAILABLE_VEHICLES

      // Build multimodal trip request for the new API
      const tripRequest = {
        waypoints: filteredWaypoints.map((waypoint, index) => ({
          location: {
            lat: waypoint.lngLat!.lat,
            lng: waypoint.lngLat!.lng,
          },
          type:
            index === 0
              ? 'origin'
              : index === filteredWaypoints.length - 1
              ? 'destination'
              : 'via',
          label: waypoint.place?.name?.value,
        })),
        availableVehicles: availableVehicles.map(vehicleType => ({
          id: `${vehicleType}-${Date.now()}`,
          type: vehicleType,
          location:
            HARDCODED_VEHICLE_LOCATIONS[
              vehicleType as keyof typeof HARDCODED_VEHICLE_LOCATIONS
            ],
        })),
        routingPreferences: {
          avoidHighways: false,
          avoidTolls: false,
          safetyVsEfficiency: 0.5, // Balanced approach
          maxWalkingDistance: 1000, // 1km max walking
          maxTransfers: 3,
        },
        requestId: `frontend-${Date.now()}-${Math.random()
          .toString(36)
          .substr(2, 9)}`,
      }

      console.log('Making multimodal trip API request:', tripRequest)
      const { data: response } = await api.post('/directions/', tripRequest)
      console.log('Multimodal trip API response received:', response)

      // Helper function to normalize mode names from backend to frontend
      const normalizeMode = (mode: string): string => {
        const modeMap: Record<string, string> = {
          biking: 'cycling',
          walking: 'walking',
          driving: 'driving',
          transit: 'transit',
        }
        return modeMap[mode] || mode
      }

      // Transform the multimodal response to match the expected trips format
      const transformedResponse: TripsResponse = {
        request: {
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
            name: waypoint.place?.name?.value || '',
          })),
          availableVehicles: availableVehicles,
          maxOptions: 3,
          includeWalking: true,
          preferences: {
            optimize: 'time' as const,
            alternatives: true,
          },
        },
        trips: response.trips.map((tripCandidate: any, tripIndex: number) => ({
          id: `${
            tripCandidate.trip.requestId || `trip-${Date.now()}`
          }-${tripIndex}`,
          mode: normalizeMode(
            tripCandidate.trip.segments[0]?.mode || 'walking',
          ),
          vehicleType:
            tripCandidate.trip.segments[0]?.vehicle?.type || 'walking',
          summary: {
            totalDuration: tripCandidate.trip.tripStats.totalDuration,
            totalDistance: tripCandidate.trip.tripStats.totalDistance,
            hasTolls: false, // TODO: Extract from segments
            hasHighways: false, // TODO: Extract from segments
            hasFerries: false, // TODO: Extract from segments
          },
          segments: tripCandidate.trip.segments
            .map((segment: any) => {
              // Check if this is a combined multimodal segment with detailed segments
              if (segment.details?.multimodalSegments) {
                // Extract the individual segments from the combined segment
                return segment.details.multimodalSegments.map(
                  (detailSegment: any, detailIndex: number) => ({
                    id: `segment-${segment.segmentIndex}-detail-${detailIndex}`,
                    type: 'route',
                    mode: normalizeMode(detailSegment.mode),
                    vehicleType:
                      detailSegment.vehicle?.type || detailSegment.mode,
                    startTime: new Date(detailSegment.startTime),
                    endTime: new Date(detailSegment.endTime),
                    duration: detailSegment.duration,
                    distance: detailSegment.distance,
                    geometry: detailSegment.geometry,
                    instructions: detailSegment.instructions,
                  }),
                )
              } else {
                // Regular single segment
                return [
                  {
                    id: `segment-${segment.segmentIndex}`,
                    type: 'route',
                    mode: normalizeMode(segment.mode),
                    vehicleType: segment.vehicle?.type || segment.mode,
                    startTime: new Date(segment.startTime),
                    endTime: new Date(segment.endTime),
                    duration: segment.duration,
                    distance: segment.distance,
                    geometry: segment.geometry,
                    instructions: segment.instructions,
                  },
                ]
              }
            })
            .flat(), // Flatten the array to handle multimodal segments
          startTime: new Date(tripCandidate.trip.earliestStartTime),
          endTime: new Date(tripCandidate.trip.latestEndTime),
          isRecommended: tripCandidate.rank === 1,
          rank: tripCandidate.rank,
          provider: 'multimodal',
          cost: tripCandidate.trip.tripStats.totalCost,
          co2Emissions: tripCandidate.trip.tripStats.totalCo2,
        })),
        earliestStart:
          response.trips[0]?.trip.earliestStartTime || new Date().toISOString(),
        latestEnd:
          response.trips[0]?.trip.latestEndTime ||
          new Date(Date.now() + 3600000).toISOString(),
        metadata: response.metadata,
      }

      directionsStore.setTrips(transformedResponse)
    } catch (error) {
      console.error('Error getting trips:', error)
      directionsStore.unsetTrips()
      // Reset the last request key on error so user can retry
      lastRequestKey.value = ''
    } finally {
      isRequestInProgress.value = false
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

  function clearWaypoints() {
    directionsStore.setWaypoints([
      { lngLat: null },
      { lngLat: null },
    ] as Waypoint[])
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

  // Watch for changes and call getDirections immediately
  watch(
    [waypoints, selectedMode],
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
    clearWaypoints,
    removeWaypoint,
    addWaypoint,
    directionsFrom,
    directionsTo,
  }
}

export const useDirectionsService = createSharedComposable(directionsService)
