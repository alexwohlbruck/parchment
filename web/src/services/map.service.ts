import {
  MapCamera,
  MapEngine,
  MapProjection,
  MapTheme,
  StreetViewType,
  type Layer,
  type MapEvents,
  MarkerIds,
  type MarkerId,
  type LngLat,
  LayerType,
} from '@/types/map.types'
import { useMapStore } from '../stores/map.store'
import { useAppStore } from '../stores/app.store'
import { useDirectionsStore } from '@/stores/directions.store'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { IntegrationId } from '@server/types/integration.types'
import { createSharedComposable, useDark } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { MapboxStrategy } from '@/components/map/map-providers/mapbox.strategy'
import { MaplibreStrategy } from '@/components/map/map-providers/maplibre.strategy'
import { mapEventBus } from '@/lib/eventBus'
import { MapStrategy } from '@/components/map/map-providers/map.strategy'
import { watch } from 'vue'
import { AppRoute } from '@/router'
import { useRouter } from 'vue-router'
import { ref } from 'vue'
import { Component } from 'vue'

const dark = useDark()

// TODO: Move to constants file
// Constants for map padding behavior
const MAP_PADDING_CONFIG = {
  CHANGE_THRESHOLD: 5, // pixels
  TRANSITION_DELAY: 150, // ms - delay for UI transitions
  INIT_DELAY: 100, // ms - delay for map initialization
} as const

function mapService() {
  const mapStore = useMapStore()
  const appStore = useAppStore()
  const directionsStore = useDirectionsStore()
  const integrationsStore = useIntegrationsStore()
  const { enabledLayers } = storeToRefs(mapStore)
  const router = useRouter()
  let mapStrategy: MapStrategy
  let mapContainer: HTMLElement

  // Track map loading state and queued operations
  const isMapReady = ref(false)
  const queuedTrips = ref<{ trips: any; visibleTripIds: Set<string> } | null>(
    null,
  )

  // Debounced padding update to prevent excessive calls
  let paddingUpdateTimeout: NodeJS.Timeout | null = null

  function getMapStrategy(
    container: string | HTMLElement,
    mapEngine: MapEngine,
    accessToken?: string,
  ) {
    const { mapOptions, mapCamera } = mapStore

    const options = {
      ...mapOptions,
      theme: dark.value ? MapTheme.DARK : MapTheme.LIGHT,
      camera: mapCamera,
    }

    switch (mapEngine) {
      case MapEngine.MAPBOX:
        return new MapboxStrategy(container, options, accessToken)
      case MapEngine.MAPLIBRE:
        return new MaplibreStrategy(container, options, accessToken)
    }
  }

  function setMapContainer(container: HTMLElement) {
    mapContainer = container
  }

  function getMapEngineCredentials(mapEngine: MapEngine) {
    switch (mapEngine) {
      case MapEngine.MAPBOX:
        return integrationsStore.getIntegrationConfigValue(
          IntegrationId.MAPBOX,
          'accessToken',
        )
      case MapEngine.MAPLIBRE:
        // MapLibre doesn't need credentials, but could be extended for API keys
        return undefined
      default:
        return undefined
    }
  }

  function canInitializeMapEngine(mapEngine: MapEngine): boolean {
    switch (mapEngine) {
      case MapEngine.MAPBOX:
        return !!getMapEngineCredentials(mapEngine)
      case MapEngine.MAPLIBRE:
        return true // MapLibre always works
      default:
        return false
    }
  }

  function initializeMap(container: HTMLElement, mapEngine: MapEngine) {
    mapContainer = container as HTMLElement

    // Check if we can initialize this map engine
    if (!canInitializeMapEngine(mapEngine)) {
      console.warn(
        `Cannot initialize ${mapEngine}: missing credentials or unsupported engine`,
      )
      return null
    }

    // Get credentials for the map engine
    const accessToken = getMapEngineCredentials(mapEngine)

    mapStrategy = getMapStrategy(container, mapEngine, accessToken)
    mapStore.setMapStrategy(mapStrategy)

    mapEventBus.on('load', () => {
      console.log('Map loaded, setting isMapReady to true')
      isMapReady.value = true
      mapStore.initializeLayers(enabledLayers.value)

      // Show waypoint markers immediately when map loads
      const waypoints = directionsStore.waypoints
      if (waypoints && waypoints.length > 0) {
        console.log('Map loaded, showing initial waypoint markers')
        mapStrategy?.setWaypointMarkers(waypoints)
      }

      // Process any queued trips
      if (queuedTrips.value) {
        console.log('Processing queued trips after map load')
        mapStrategy?.setTrips(
          queuedTrips.value.trips,
          queuedTrips.value.visibleTripIds,
        )
        queuedTrips.value = null
      }
    })

    mapEventBus.on('style.load', () => {
      console.log('Map style loaded, setting isMapReady to true')
      isMapReady.value = true
      mapStore.initializeLayers(enabledLayers.value)

      // Show waypoint markers immediately when style loads
      const waypoints = directionsStore.waypoints
      if (waypoints && waypoints.length > 0) {
        console.log('Map style loaded, showing initial waypoint markers')
        mapStrategy?.setWaypointMarkers(waypoints)
      }

      // Process any queued trips
      if (queuedTrips.value) {
        console.log('Processing queued trips after style load')
        mapStrategy?.setTrips(
          queuedTrips.value.trips,
          queuedTrips.value.visibleTripIds,
        )
        queuedTrips.value = null
      }
    })

    mapEventBus.on('move', data => {
      mapStore.emit('move', data)
    })

    mapEventBus.on('moveend', data => {
      mapStore.setMapCamera(data)
    })

    mapEventBus.on('click:mapillary-image', ({ lngLat, image }) => {
      if (image) {
        mapStrategy.flyTo({
          center: lngLat,
        })
        router.push({
          name: AppRoute.STREET,
          params: {
            id: image.id,
          },
        })
      }
    })

    mapEventBus.on('click:poi', ({ osmId, poiType, lngLat }) => {
      if (lngLat) {
        // Remove any existing POI markers
        mapStrategy.removeAllMarkers()

        // Add marker at clicked location
        mapStrategy.addMarker(MarkerIds.SELECTED_POI, lngLat)
      }

      router.push({
        name: AppRoute.PLACE,
        params: {
          type: poiType,
          id: osmId,
        },
      })
    })

    return mapStrategy
  }

  /**
   * Calculate padding values based on visible map area
   * Extracted utility function to avoid code duplication
   */
  function calculateMapPadding(): {
    padding: MapCamera['padding']
    isFullyVisible: boolean
  } | null {
    if (!mapContainer) {
      return null
    }

    const visibleArea = appStore.visibleMapArea
    const mapWidth = mapContainer.clientWidth
    const mapHeight = mapContainer.clientHeight

    // Check if we have valid dimensions
    if (!mapWidth || !mapHeight) {
      return null
    }

    // Check if the full map is visible
    const isFullyVisible =
      visibleArea.width === mapWidth && visibleArea.height === mapHeight

    if (isFullyVisible) {
      return {
        padding: { top: 0, bottom: 0, left: 0, right: 0 },
        isFullyVisible: true,
      }
    }

    // Calculate padding values
    const padding = {
      left: Math.max(0, visibleArea.x),
      top: Math.max(0, visibleArea.y),
      right: Math.max(0, mapWidth - (visibleArea.x + visibleArea.width)),
      bottom: Math.max(0, mapHeight - (visibleArea.y + visibleArea.height)),
    }

    return { padding, isFullyVisible: false }
  }

  /**
   * Check if two padding objects are significantly different
   */
  function hasPaddingChanged(
    oldPadding: MapCamera['padding'],
    newPadding: MapCamera['padding'],
  ): boolean {
    if (!oldPadding || !newPadding) return true

    const threshold = MAP_PADDING_CONFIG.CHANGE_THRESHOLD
    return (
      Math.abs((oldPadding.left || 0) - (newPadding.left || 0)) > threshold ||
      Math.abs((oldPadding.top || 0) - (newPadding.top || 0)) > threshold ||
      Math.abs((oldPadding.right || 0) - (newPadding.right || 0)) > threshold ||
      Math.abs((oldPadding.bottom || 0) - (newPadding.bottom || 0)) > threshold
    )
  }

  /**
   * Debounced update of map padding
   */
  function debouncedUpdateMapPadding(
    delay: number = MAP_PADDING_CONFIG.TRANSITION_DELAY,
  ) {
    if (paddingUpdateTimeout) {
      clearTimeout(paddingUpdateTimeout)
    }

    paddingUpdateTimeout = setTimeout(() => {
      updateMapPadding()
      paddingUpdateTimeout = null
    }, delay)
  }

  // Helper function to adjust camera center based on visible map area
  // Note: This is used for manual camera operations (flyTo/jumpTo)
  // Automatic padding adjustment is handled by the visibleMapArea watcher
  function adjustCameraForVisibleCenter(
    camera: Partial<MapCamera>,
  ): Partial<MapCamera> {
    const adjustedCamera = { ...camera }

    // If padding is already provided in the camera object, use it as-is
    if (camera.padding) {
      return adjustedCamera
    }

    try {
      const paddingResult = calculateMapPadding()

      if (!paddingResult || !mapStrategy) {
        return adjustedCamera
      }

      // Set padding to ensure the camera operation respects the visible area
      adjustedCamera.padding = paddingResult.padding
      return adjustedCamera
    } catch (error) {
      console.warn('Error adjusting camera for visible map area:', error)
      return camera
    }
  }

  function flyTo(camera: Partial<MapCamera>) {
    const adjustedCamera = adjustCameraForVisibleCenter(camera)
    mapStrategy.flyTo(adjustedCamera)
  }

  function jumpTo(camera: Partial<MapCamera>) {
    const adjustedCamera = adjustCameraForVisibleCenter(camera)
    mapStrategy.jumpTo(adjustedCamera)
  }

  function setMapEngine(mapEngine: MapEngine) {
    destroy()
    isMapReady.value = false // Reset map ready state
    queuedTrips.value = null // Clear any queued trips
    mapStore.setMapEngine(mapEngine)

    // Only initialize map if we have a container
    if (!mapContainer) {
      console.warn('Cannot switch map engine: map container not initialized')
      return
    }

    // Check if we can initialize this map engine
    if (!canInitializeMapEngine(mapEngine)) {
      console.warn(
        `Cannot switch to ${mapEngine}: missing credentials or unsupported engine`,
      )
      return
    }

    // Get credentials for the map engine
    const accessToken = getMapEngineCredentials(mapEngine)

    mapStrategy = getMapStrategy(mapContainer, mapEngine, accessToken)
    mapStore.setMapStrategy(mapStrategy)
  }

  function setMapProjection(projection: MapProjection) {
    mapStore.setMapProjection(projection)
  }

  watch(
    () => mapStore.mapProjection,
    projection => {
      mapStrategy?.setMapProjection(projection)
    },
  )

  function toggle3dTerrain(value?: boolean) {
    mapStore.setMap3dTerrain(value)
  }

  watch(
    () => mapStore.map3dTerrain,
    value => {
      mapStrategy?.setMap3dTerrain(value)
    },
  )

  function toggle3dBuildings(value?: boolean) {
    mapStore.setMap3dBuildings(value)
  }

  watch(
    () => mapStore.map3dBuildings,
    value => {
      mapStrategy?.setMap3dBuildings(value)
    },
  )

  function togglePoiLabels(value?: boolean) {
    mapStore.setMapPoiLabels(value)
  }

  watch(
    () => mapStore.mapPoiLabels,
    value => {
      mapStrategy?.setPoiLabels(value)
    },
  )

  function toggleRoadLabels(value?: boolean) {
    mapStore.setMapRoadLabels(value)
  }

  watch(
    () => mapStore.mapRoadLabels,
    value => {
      mapStrategy?.setRoadLabels(value)
    },
  )

  function toggleTransitLabels(value?: boolean) {
    mapStore.setMapTransitLabels(value)
  }

  watch(
    () => mapStore.mapTransitLabels,
    value => {
      mapStrategy?.setTransitLabels(value)
    },
  )

  function togglePlaceLabels(value?: boolean) {
    mapStore.setMapPlaceLabels(value)
  }

  watch(
    () => mapStore.mapPlaceLabels,
    value => {
      mapStrategy?.setPlaceLabels(value)
    },
  )

  function resize() {
    mapStrategy?.resize()
  }

  /**
   * Update map padding to keep orbit point centered in unobstructed area
   * Uses easeTo with padding to smoothly adjust the map's effective viewport
   */
  function updateMapPadding() {
    if (!mapStrategy || !mapContainer) {
      console.warn('Cannot update map padding: map not ready')
      return
    }

    try {
      const paddingResult = calculateMapPadding()

      if (!paddingResult) {
        console.warn('Cannot calculate map padding: invalid dimensions')
        return
      }

      // Apply the padding using flyTo for smooth transition
      mapStrategy.flyTo({
        padding: paddingResult.padding,
      })

      if (process.env.NODE_ENV === 'development') {
        console.log('Updated map padding:', {
          padding: paddingResult.padding,
          isFullyVisible: paddingResult.isFullyVisible,
          visibleArea: appStore.visibleMapArea,
          mapDimensions: {
            width: mapContainer.clientWidth,
            height: mapContainer.clientHeight,
          },
        })
      }
    } catch (error) {
      console.error('Error updating map padding:', error)
    }
  }

  // Watch for changes in the visible map area and automatically adjust padding
  watch(
    () => appStore.visibleMapArea,
    (newVisibleArea, oldVisibleArea) => {
      // Only update if the map is ready and we have valid areas
      if (
        !isMapReady.value ||
        !mapStrategy ||
        !newVisibleArea ||
        !oldVisibleArea
      ) {
        return
      }

      // Calculate old and new padding to check for significant changes
      const oldPaddingResult = calculateMapPadding()
      if (!oldPaddingResult) return

      // Use a more sophisticated change detection based on actual padding values
      const hasSignificantChange =
        Math.abs(newVisibleArea.x - oldVisibleArea.x) >
          MAP_PADDING_CONFIG.CHANGE_THRESHOLD ||
        Math.abs(newVisibleArea.y - oldVisibleArea.y) >
          MAP_PADDING_CONFIG.CHANGE_THRESHOLD ||
        Math.abs(newVisibleArea.width - oldVisibleArea.width) >
          MAP_PADDING_CONFIG.CHANGE_THRESHOLD ||
        Math.abs(newVisibleArea.height - oldVisibleArea.height) >
          MAP_PADDING_CONFIG.CHANGE_THRESHOLD

      if (hasSignificantChange) {
        if (process.env.NODE_ENV === 'development') {
          console.log(
            'Visible area changed significantly, updating map padding:',
            {
              old: oldVisibleArea,
              new: newVisibleArea,
            },
          )
        }

        // Use debounced update to prevent excessive calls during animations
        debouncedUpdateMapPadding()
      }
    },
    { deep: true },
  )

  // Also update padding when map becomes ready
  watch(isMapReady, ready => {
    if (ready) {
      // Use init delay to ensure map is fully initialized
      debouncedUpdateMapPadding(MAP_PADDING_CONFIG.INIT_DELAY)
    }
  })

  watch(dark, newDark => {
    mapStrategy?.setMapTheme(newDark ? MapTheme.DARK : MapTheme.LIGHT)
  })

  watch(
    () => mapStore.pegman,
    (pegman, oldPegman) => {
      if (pegman) {
        mapStrategy?.setPegman(pegman)
      }
    },
  )

  watch(
    () => router.currentRoute.value.name,
    (routeName, oldRouteName) => {
      if (oldRouteName === AppRoute.STREET && routeName !== AppRoute.STREET) {
        mapStrategy?.removePegman()
      }
    },
  )

  watch(
    () => mapStore.mapOptions.basemap,
    basemap => {
      mapStrategy?.setBasemap(basemap)
    },
  )

  watch(
    () => directionsStore.directions,
    directions => {
      if (directions) {
        mapStrategy?.setDirections(directions)
      } else {
        mapStrategy?.unsetDirections()
      }
    },
  )

  // Watch for trip changes
  watch(
    () => directionsStore.trips,
    trips => {
      console.log(
        'Trips changed in map service:',
        !!trips,
        'isMapReady:',
        isMapReady.value,
      )

      if (trips) {
        // Show the first trip by default (recommended or first in list)
        const firstTrip =
          trips.trips.find(trip => trip.isRecommended) || trips.trips[0]
        const defaultTripIds = firstTrip
          ? new Set([firstTrip.id])
          : new Set<string>()

        if (isMapReady.value && mapStrategy) {
          console.log('Map is ready, showing first trip and waypoints')
          mapStrategy.setTrips(trips, defaultTripIds)
        } else {
          console.log('Map not ready, queuing first trip and waypoints')
          queuedTrips.value = { trips, visibleTripIds: defaultTripIds }
        }
      } else {
        console.log('Trips cleared, unsetting trips')
        if (mapStrategy) {
          mapStrategy.unsetTrips()
        }
        queuedTrips.value = null
      }
    },
  )

  // Watch for waypoint changes and always show waypoint markers
  watch(
    () => directionsStore.waypoints,
    waypoints => {
      console.log('Waypoints changed in map service:', waypoints.length)

      if (isMapReady.value && mapStrategy) {
        console.log('Map is ready, updating waypoint markers')
        mapStrategy.setWaypointMarkers(waypoints)
      }
      // Note: We don't queue waypoint markers since they're managed separately
    },
    { deep: true },
  )

  // Watch for selected trip changes
  watch(
    () => directionsStore.selectedTripId,
    (selectedTripId, oldSelectedTripId) => {
      const trips = directionsStore.trips
      if (!trips || !selectedTripId) return

      console.log('Selected trip changed:', selectedTripId)

      const visibleTripIds = new Set([selectedTripId])

      if (isMapReady.value && mapStrategy) {
        mapStrategy.setTrips(trips, visibleTripIds)
      } else {
        queuedTrips.value = { trips, visibleTripIds }
      }
    },
  )

  function toggleLayer(layerId: Layer['configuration']['id'], state?: boolean) {
    mapStore.toggleLayer(layerId, state)
  }

  function toggleLayerVisibility(
    layerId: Layer['configuration']['id'],
    state?: boolean,
  ) {
    if (state === undefined) {
      state = !mapStore.layers.find(layer => layer.configuration.id === layerId)
        ?.visible
    }
    mapStore.toggleLayerVisibility(layerId, state)
  }

  function toggleStreetViewLayers(visible?: boolean) {
    mapStore.layers.forEach(layer => {
      if (layer.type === LayerType.STREET_VIEW) {
        toggleLayerVisibility(layer.configuration.id, visible)
      }
    })
  }

  function destroy() {
    // Reset state
    isMapReady.value = false
    queuedTrips.value = null

    // Clear any pending padding updates
    if (paddingUpdateTimeout) {
      clearTimeout(paddingUpdateTimeout)
      paddingUpdateTimeout = null
    }

    // Remove event listeners
    // TODO: Automatically remove all listeners without explicitly naming them
    mapEventBus.off('load')
    mapEventBus.off('style.load')
    mapEventBus.off('move')
    mapStrategy?.destroy() // Remove map instance
  }

  /**
   * Set which trips are visible on the map
   */
  function setVisibleTrips(tripIds: string[]) {
    const trips = directionsStore.trips
    if (!trips) {
      return
    }

    const visibleTripIds = new Set(tripIds)

    if (isMapReady.value && mapStrategy) {
      mapStrategy.setTrips(trips, visibleTripIds)
    } else {
      queuedTrips.value = { trips, visibleTripIds }
    }
  }

  /**
   * Show all trips on the map
   */
  function showAllTrips() {
    const trips = directionsStore.trips
    if (!trips) return

    const allTripIds = new Set(trips.trips.map(trip => trip.id))

    if (isMapReady.value && mapStrategy) {
      console.log('Showing all trips')
      mapStrategy.setTrips(trips, allTripIds)
    } else {
      console.log('Map not ready, queuing all trips')
      queuedTrips.value = { trips, visibleTripIds: allTripIds }
    }
  }

  /**
   * Show only waypoint markers without any trip routes
   */
  function showOnlyWaypoints() {
    const trips = directionsStore.trips
    if (!trips) return

    // Pass empty set to hide all trip routes but keep waypoints
    const noTripIds = new Set<string>()

    if (isMapReady.value && mapStrategy) {
      console.log('Showing only waypoints')
      mapStrategy.setTrips(trips, noTripIds)
      // Reset selected trip to null when showing only waypoints
      directionsStore.setSelectedTripId(null)
    } else {
      console.log('Map not ready, queuing waypoints only')
      queuedTrips.value = { trips, visibleTripIds: noTripIds }
    }
  }

  /**
   * Show specific trip on hover
   */
  function showTripOnHover(tripId: string) {
    const trips = directionsStore.trips
    if (!trips) return

    console.log('Showing trip on hover:', tripId)

    // Update selected trip in store
    directionsStore.setSelectedTripId(tripId)
  }

  /**
   * Show the default trip (first/recommended)
   */
  function showDefaultTrip() {
    const trips = directionsStore.trips
    if (!trips || trips.trips.length === 0) return

    const firstTrip =
      trips.trips.find(trip => trip.isRecommended) || trips.trips[0]
    if (firstTrip) {
      directionsStore.setSelectedTripId(firstTrip.id)
    }
  }

  /**
   * Map events
   */
  function on<K extends keyof MapEvents>(
    event: K,
    handler: (data: MapEvents[K]) => void,
  ) {
    mapStore.on(event, handler)
  }

  function off<K extends keyof MapEvents>(
    event: K,
    handler: (data: MapEvents[K]) => void,
  ) {
    mapStore.off(event, handler)
  }

  function emit<K extends keyof MapEvents>(event: K, data: MapEvents[K]) {
    mapStore.emit(event, data)
  }

  function zoomIn() {
    mapStrategy?.zoomIn()
  }

  function zoomOut() {
    mapStrategy?.zoomOut()
  }

  function resetNorth() {
    mapStrategy?.resetNorth()
  }

  return {
    initializeMap,
    resize,
    updateMapPadding,
    toggleLayer,
    toggleLayerVisibility,
    toggleStreetViewLayers,
    flyTo,
    jumpTo,
    setMapEngine,
    setMapProjection,
    toggle3dTerrain,
    toggle3dBuildings,
    togglePoiLabels,
    toggleRoadLabels,
    toggleTransitLabels,
    togglePlaceLabels,
    destroy,
    on,
    off,
    emit,
    setPegman: mapStore.setPegman,
    clearPegman: mapStore.clearPegman,
    addMarker: (id: MarkerId, lngLat: LngLat) =>
      mapStrategy?.addMarker(id, lngLat),
    addVueMarker: (
      id: string,
      lngLat: LngLat,
      component: Component,
      props: Record<string, any> = {},
    ) => mapStrategy?.addVueMarker(id, lngLat, component, props),
    removeAllMarkers: () => mapStrategy?.removeAllMarkers(),
    zoomIn,
    zoomOut,
    resetNorth,
    locate: () => mapStrategy?.locate(),
    setMapContainer,
    setVisibleTrips,
    showAllTrips,
    showOnlyWaypoints,
    showTripOnHover,
    showDefaultTrip,
  }
}

export const useMapService = createSharedComposable(mapService)
