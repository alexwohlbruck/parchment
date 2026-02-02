import { watch, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { api } from '@/lib/api'
import { createSharedComposable } from '@vueuse/core'
import { useDirectionsStore } from '@/stores/directions.store'
import { Waypoint } from '@/types/map.types'
import { TripsResponse, WaypointType } from '@/types/directions.types'

const MIN_WAYPOINTS = 2

// TODO: Move to database per user
const HARDCODED_VEHICLE_LOCATIONS = {
  car: { lat: 35.21712207929376, lng: -80.81946433041882 },
  bike: { lat: 35.21700938703438, lng: -80.81994398107717 },
}

function directionsService() {
  const store = useDirectionsStore()
  const { waypoints, selectedMode, routingPreferences } = storeToRefs(store)

  const lastRequestKey = ref('')
  const isRequesting = ref(false)

  /**
   * Generate unique key for request deduplication
   */
  function getRequestKey(wps: Waypoint[], mode: string, prefs: any): string {
    const coords = wps
      .filter(wp => wp.lngLat)
      .map(wp => `${wp.lngLat!.lat},${wp.lngLat!.lng}`)
      .join(';')
    return `${coords}|${mode}|${JSON.stringify(prefs)}`
  }

  /**
   * Fetch directions from API
   */
  async function getDirections() {
    const validWaypoints = waypoints.value.filter(wp => wp.lngLat)
    const requestKey = getRequestKey(
      validWaypoints,
      selectedMode.value,
      routingPreferences.value,
    )

    // Skip duplicate or concurrent requests
    if (requestKey === lastRequestKey.value || isRequesting.value) return

    // Need at least 2 waypoints
    if (validWaypoints.length < MIN_WAYPOINTS) {
      store.unsetTrips()
      lastRequestKey.value = ''
      return
    }

    lastRequestKey.value = requestKey
    isRequesting.value = true
    store.setLoading(true)

    try {
      // Send all known vehicles - backend will determine which are relevant for the selected mode
      const useVehicleLocations =
        routingPreferences.value.useKnownVehicleLocations !== false

      const availableVehicles = useVehicleLocations
        ? Object.entries(HARDCODED_VEHICLE_LOCATIONS).map(
            ([type, location]) => ({
              id: `${type}-${Date.now()}`,
              type,
              location,
            }),
          )
        : []

      // Build API request
      const request = {
        waypoints: validWaypoints.map((wp, i) => ({
          location: { lat: wp.lngLat!.lat, lng: wp.lngLat!.lng },
          type:
            i === 0
              ? 'origin'
              : i === validWaypoints.length - 1
                ? 'destination'
                : 'via',
          label: wp.place?.name?.value,
        })),
        selectedMode: selectedMode.value,
        availableVehicles,
        routingPreferences: routingPreferences.value,
        requestId: `frontend-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      }

      const { data } = await api.post('/directions/', request)

      // Transform response to UI format
      const response: TripsResponse = {
        request: {
          waypoints: validWaypoints.map((wp, i) => ({
            id: `wp-${i}`,
            coordinate: { lat: wp.lngLat!.lat, lng: wp.lngLat!.lng },
            type:
              i === 0 || i === validWaypoints.length - 1
                ? WaypointType.STOP
                : WaypointType.VIA,
            name: wp.place?.name?.value || '',
          })),
          availableVehicles: availableVehicles.map(v => v.type),
          maxOptions: 5,
          includeWalking: true,
          preferences: { optimize: 'time', alternatives: true },
        },
        trips: data.trips.map((candidate: any, idx: number) => ({
          id: `${candidate.trip.requestId || `trip-${Date.now()}`}-${idx}`,
          mode: normalizeMode(candidate.trip.segments[0]?.mode || 'walking'),
          vehicleType: candidate.trip.segments[0]?.vehicle?.type || 'walking',
          summary: {
            totalDuration: candidate.trip.tripStats.totalDuration,
            totalDistance: candidate.trip.tripStats.totalDistance,
            hasTolls: false,
            hasHighways: false,
            hasFerries: false,
          },
          segments: flattenSegments(candidate.trip.segments),
          startTime: new Date(candidate.trip.earliestStartTime),
          endTime: new Date(candidate.trip.latestEndTime),
          isRecommended: candidate.rank === 1,
          rank: candidate.rank,
          provider: 'multimodal',
          cost: candidate.trip.tripStats.totalCost,
          co2Emissions: candidate.trip.tripStats.totalCo2,
        })),
        earliestStart:
          data.trips[0]?.trip.earliestStartTime || new Date().toISOString(),
        latestEnd:
          data.trips[0]?.trip.latestEndTime ||
          new Date(Date.now() + 3600000).toISOString(),
        metadata: data.metadata,
      }

      store.setTrips(response)
    } catch (error) {
      console.error('Failed to fetch directions:', error)
      store.unsetTrips()
      lastRequestKey.value = '' // Allow retry
    } finally {
      isRequesting.value = false
      store.setLoading(false)
    }
  }

  /**
   * Normalize mode names from backend to frontend
   */
  function normalizeMode(mode: string): string {
    const map: Record<string, string> = {
      biking: 'cycling',
      walking: 'walking',
      driving: 'driving',
      transit: 'transit',
    }
    return map[mode] || mode
  }

  /**
   * Flatten multimodal segments into single array
   */
  function flattenSegments(segments: any[]): any[] {
    return segments.flatMap(segment => {
      if (segment.details?.multimodalSegments) {
        return segment.details.multimodalSegments.map(
          (seg: any, i: number) => ({
            id: `segment-${segment.segmentIndex}-${i}`,
            type: 'route',
            mode: normalizeMode(seg.mode),
            vehicleType: seg.vehicle?.type || seg.mode,
            startTime: new Date(seg.startTime),
            endTime: new Date(seg.endTime),
            duration: seg.duration,
            distance: seg.distance,
            geometry: seg.geometry,
            instructions: seg.instructions,
            totalElevationGain: seg.totalElevationGain,
            totalElevationLoss: seg.totalElevationLoss,
            maxElevation: seg.maxElevation,
            minElevation: seg.minElevation,
          }),
        )
      }

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
          totalElevationGain: segment.totalElevationGain,
          totalElevationLoss: segment.totalElevationLoss,
          maxElevation: segment.maxElevation,
          minElevation: segment.minElevation,
        },
      ]
    })
  }

  // Waypoint management
  function fillWaypoint(waypoint: Waypoint) {
    const emptyIndex = waypoints.value.findIndex(wp => !wp.lngLat)
    if (emptyIndex !== -1) {
      store.setWaypoint(emptyIndex, waypoint)
    } else {
      store.setWaypoint(waypoints.value.length, waypoint)
    }
  }

  function setWaypoint(index: number, waypoint: Waypoint) {
    store.setWaypoint(index, waypoint)
  }

  function setWaypoints(wps: Waypoint[]) {
    store.setWaypoints(wps)
  }

  function clearWaypoints() {
    store.setWaypoints([{ lngLat: null }, { lngLat: null }] as Waypoint[])
  }

  function removeWaypoint(index: number) {
    if (waypoints.value.length <= MIN_WAYPOINTS) {
      store.setWaypoint(index, { ...waypoints.value[index], lngLat: null })
    } else {
      store.removeWaypoint(index)
    }
  }

  function addWaypoint(waypoint?: Waypoint) {
    store.setWaypoint(waypoints.value.length, waypoint || { lngLat: null })
  }

  function directionsFrom(waypoint: Waypoint) {
    store.setWaypoint(0, waypoint)
  }

  function directionsTo(waypoint: Waypoint) {
    store.setWaypoint(1, waypoint)
  }

  // Auto-fetch when waypoints, mode, or preferences change
  watch([waypoints, selectedMode, routingPreferences], getDirections, {
    deep: true,
  })

  return {
    getDirections,
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
