import {
  MapCamera,
  MapEngine,
  MapProjection,
  MapTheme,
  MapColorTheme,
  StreetViewType,
  type Layer,
  type MapEvents,
  MarkerIds,
  type MarkerId,
  type LngLat,
  LayerType,
  MapSettings,
} from '@/types/map.types'
import type { Place } from '@/types/place.types'
import { useMapStore } from '../stores/map.store'
import { useLayersStore } from '@/stores/layers.store'
import { useLayersService } from '@/services/layers/layers.service'
import { usePlacePolygonLayerService } from '@/services/layers/features/place-polygon-layer.service'
import { useSearchResultsLayerService } from '@/services/layers/features/search-results-layer.service'
import { useMarkerLayersService } from '@/services/layers/markers/marker-layers.service'
import { useAppStore } from '../stores/app.store'
import { useDirectionsStore } from '@/stores/directions.store'
import { useThemeStore } from '@/stores/theme.store'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { IntegrationId } from '@server/types/integration.types'
import { createSharedComposable, useDark } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { MapboxStrategy } from '@/components/map/map-providers/mapbox.strategy'
import { MaplibreStrategy } from '@/components/map/map-providers/maplibre.strategy'
import { mapEventBus } from '@/lib/eventBus'
import { MapStrategy } from '@/components/map/map-providers/map.strategy'
import { AppRoute } from '@/router'
import { useRouter } from 'vue-router'
import { ref, toRaw, watch, Component } from 'vue'
import { storedLocale } from '@/lib/i18n'

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
  const layersStore = useLayersStore()
  const layersService = useLayersService()
  const placePolygonLayerService = usePlacePolygonLayerService()
  const searchResultsLayerService = useSearchResultsLayerService()
  const markerLayersService = useMarkerLayersService()
  const appStore = useAppStore()
  const directionsStore = useDirectionsStore()
  const integrationsStore = useIntegrationsStore()
  const themeStore = useThemeStore()
  const { settings } = storeToRefs(mapStore)
  const { layers } = storeToRefs(layersStore)
  const { accentColor, isDark } = storeToRefs(themeStore)
  const router = useRouter()
  let mapStrategy: MapStrategy
  let mapContainer: HTMLElement

  // Track map loading state and queued operations
  const isMapReady = ref(false)
  const queuedTrips = ref<{ trips: any; visibleTripIds: Set<string> } | null>(
    null,
  )
  let isReinitializingForLanguage = false

  // Track map interaction states for conditional control visibility
  const isRotatedOrPitched = ref(false)
  const isCurrentlyRotating = ref(false)
  const isCurrentlyZooming = ref(false)
  let rotatingHideTimeout: ReturnType<typeof setTimeout> | null = null
  let zoomingHideTimeout: ReturnType<typeof setTimeout> | null = null
  const CONTROL_HIDE_DELAY = 1500 // ms before hiding controls after interaction stops

  // Debounced padding update to prevent excessive calls
  let paddingUpdateTimeout: ReturnType<typeof setTimeout> | null = null

  // Watch for theme changes to update polygon colors
  watch([accentColor, isDark], () => {
    if (mapStrategy && isMapReady.value) {
      placePolygonLayerService.updatePlacePolygonColors(mapStrategy)
    }
  })

  function getMapStrategy(
    container: string | HTMLElement,
    mapEngine: MapEngine,
    accessToken?: string,
    language?: string,
  ) {
    const { settings, mapCamera } = mapStore

    const options = {
      ...settings,
      theme: dark.value ? MapTheme.DARK : MapTheme.LIGHT,
      camera: mapCamera,
    }

    // Convert locale to language code (e.g., 'en-US' -> 'en')
    const languageCode = language ? language.split('-')[0] : undefined

    switch (mapEngine) {
      case MapEngine.MAPBOX:
        return new MapboxStrategy(container, options, accessToken, languageCode)
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
        return integrationsStore.isMapboxEngineActive
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

    // Get current language for initialization
    const currentLanguage = storedLocale.value

    mapStrategy = getMapStrategy(
      container,
      mapEngine,
      accessToken,
      currentLanguage,
    )
    mapStore.setMapStrategy(mapStrategy)

    mapEventBus.on('load', async () => {
      onMapLoad()
    })

    mapEventBus.on('style.load', async () => {
      onStyleLoad()
    })

    mapEventBus.on('move', data => {
      mapStore.emit('move', data)
    })

    mapEventBus.on('moveend', data => {
      mapStore.setMapCamera(data)
    })

    // Track rotation/pitch state for conditional control visibility
    mapEventBus.on('move', data => {
      const { bearing, pitch } = data
      const wasRotatedOrPitched = isRotatedOrPitched.value
      isRotatedOrPitched.value =
        Math.abs(bearing) > 0.5 || Math.abs(pitch) > 0.5

      // Detect if user is actively rotating
      if (
        wasRotatedOrPitched !== isRotatedOrPitched.value ||
        Math.abs(bearing) > 0.5 ||
        Math.abs(pitch) > 0.5
      ) {
        isCurrentlyRotating.value = true
        if (rotatingHideTimeout) clearTimeout(rotatingHideTimeout)
        rotatingHideTimeout = setTimeout(() => {
          if (!isRotatedOrPitched.value) {
            isCurrentlyRotating.value = false
          }
        }, CONTROL_HIDE_DELAY)
      }
    })

    // Track zoom state for conditional control visibility
    let previousZoom: number | null = null
    mapEventBus.on('move', data => {
      const { zoom } = data
      if (previousZoom !== null && Math.abs(zoom - previousZoom) > 0.01) {
        isCurrentlyZooming.value = true
        if (zoomingHideTimeout) clearTimeout(zoomingHideTimeout)
        zoomingHideTimeout = setTimeout(() => {
          isCurrentlyZooming.value = false
        }, CONTROL_HIDE_DELAY)
      }
      previousZoom = zoom
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

    return mapStrategy
  }

  function onMapLoad() {
    // NOTE: Layer initialization happens in onStyleLoad() after style is fully loaded
    // This function only handles map-level setup that doesn't require the style to be loaded

    isMapReady.value = true

    // Ensure map container is properly sized after load
    resize()
  }

  function onStyleLoad() {
    // Wait for style to be fully loaded before initializing layers
    const initializeAfterStyleLoad = () => {
      if (!mapStrategy?.mapInstance?.isStyleLoaded()) {
        // Style not fully loaded yet, wait a bit and try again
        setTimeout(initializeAfterStyleLoad, 50)
        return
      }

      setConfigProperties()

      // Sync client-side layer visibility with their group states
      const hasVisibleTransitLayers =
        layersStore.syncClientSideLayerVisibility()

      // Include search results layer with regular layers
      const allLayers = [
        searchResultsLayerService.createSearchResultsLayer(),
        ...layers.value,
      ]
      layersService.initializeLayers(allLayers, mapStrategy)

      // Initialize place polygon layers
      placePolygonLayerService.initializePlacePolygonLayers(mapStrategy)

      // Update polygon colors to match current theme
      placePolygonLayerService.updatePlacePolygonColors(mapStrategy)

      // Apply transit map theme if transit layers are visible
      if (hasVisibleTransitLayers && mapStrategy) {
        const themeStore = useThemeStore()
        const shouldUseFaded = hasVisibleTransitLayers && !themeStore.isDark
        mapStrategy.setMapColorTheme(
          shouldUseFaded ? MapColorTheme.FADED : MapColorTheme.DEFAULT,
        )
        mapStrategy.setTransitLabels(!hasVisibleTransitLayers)
      }

      // Initialize marker layers - they will automatically sync with store state
      markerLayersService.initializeMarkerLayers(mapStrategy)

      // Show queued trips if any
      if (queuedTrips.value) {
        mapStrategy?.setTrips(
          queuedTrips.value.trips,
          queuedTrips.value.visibleTripIds,
        )
        queuedTrips.value = null
      }

      // Note: Waypoint markers are automatically managed by WaypointsLayer
    }

    // Start the initialization process
    initializeAfterStyleLoad()
  }

  function setConfigProperties() {
    mapStrategy?.setPoiLabels(mapStore.settings.poiLabels)
    mapStrategy?.setRoadLabels(mapStore.settings.roadLabels)
    mapStrategy?.setTransitLabels(mapStore.settings.transitLabels)
    mapStrategy?.setPlaceLabels(mapStore.settings.placeLabels)
    mapStrategy?.setMap3dObjects(mapStore.settings.objects3d)
    mapStrategy?.setMap3dTerrain(mapStore.settings.terrain3d)
    mapStrategy?.setHdRoads(mapStore.settings.hdRoads)
  }

  let isInitializingGroups = false

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

  function fitBounds(
    bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number },
    options?: any,
  ) {
    if (!mapStrategy) return

    // Calculate existing map padding to account for obstructing UI elements
    const paddingInfo = calculateMapPadding()
    const basePadding = paddingInfo?.padding || {
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
    }

    // Handle different padding input formats from options
    let additionalPadding = { top: 50, bottom: 50, left: 50, right: 50 } // Default

    if (options?.padding) {
      if (typeof options.padding === 'number') {
        // Uniform padding
        additionalPadding = {
          top: options.padding,
          bottom: options.padding,
          left: options.padding,
          right: options.padding,
        }
      } else if (typeof options.padding === 'object') {
        // Object padding - merge with defaults
        additionalPadding = {
          top: options.padding.top ?? 50,
          bottom: options.padding.bottom ?? 50,
          left: options.padding.left ?? 50,
          right: options.padding.right ?? 50,
        }
      }
    }

    // Combine base padding (from UI obstructions) with additional padding
    const combinedPadding = {
      top: (basePadding.top || 0) + additionalPadding.top,
      bottom: (basePadding.bottom || 0) + additionalPadding.bottom,
      left: (basePadding.left || 0) + additionalPadding.left,
      right: (basePadding.right || 0) + additionalPadding.right,
    }

    const finalOptions = {
      ...options,
      padding: combinedPadding,
    }

    mapStrategy.fitBounds(bounds, finalOptions)
  }

  function setMapEngine(mapEngine: MapEngine) {
    destroy()
    isMapReady.value = false // Reset map ready state
    queuedTrips.value = null // Clear any queued trips
    mapStore.settings.engine = mapEngine

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

    // Get current language for initialization
    const currentLanguage = storedLocale.value

    mapStrategy = getMapStrategy(
      mapContainer,
      mapEngine,
      accessToken,
      currentLanguage,
    )
    mapStore.setMapStrategy(mapStrategy)
  }

  /**
   * Reinitialize the map with current engine settings.
   * Useful when integration configuration changes.
   */
  function reinitializeMap() {
    const currentEngine = mapStore.settings.engine
    setMapEngine(currentEngine)
  }

  function setMapProjection(projection: MapProjection) {
    mapStore.settings.projection = projection
  }

  watch(
    () => mapStore.settings.projection,
    projection => {
      mapStrategy?.setMapProjection(projection)
    },
  )

  function toggle3dTerrain(value?: boolean) {
    const newValue = value ?? !mapStore.settings.terrain3d
    mapStore.settings.terrain3d = newValue

    // 3d objects must be enabled when terrain3d is enabled
    if (newValue && !mapStore.settings.objects3d) {
      toggle3dObjects(true)
    }
  }

  function toggle3dObjects(value?: boolean) {
    const newValue = value ?? !mapStore.settings.objects3d
    mapStore.settings.objects3d = newValue

    // 3d terrain must be disabled when objects3d is disabled
    if (!newValue && mapStore.settings.terrain3d) {
      toggle3dTerrain(false)
    }
  }

  watch(
    () => mapStore.settings.terrain3d,
    value => {
      mapStrategy?.setMap3dTerrain(value)
    },
  )

  watch(
    () => mapStore.settings.objects3d,
    value => {
      mapStrategy?.setMap3dObjects(value)
    },
  )

  function togglePoiLabels(value?: boolean) {
    mapStore.settings.poiLabels = value ?? !mapStore.settings.poiLabels
  }

  watch(
    () => mapStore.settings.poiLabels,
    value => {
      mapStrategy?.setPoiLabels(value)
    },
  )

  function toggleRoadLabels(value?: boolean) {
    mapStore.settings.roadLabels = value ?? !mapStore.settings.roadLabels
  }

  watch(
    () => mapStore.settings.roadLabels,
    value => {
      mapStrategy?.setRoadLabels(value)
    },
  )

  function toggleTransitLabels(value?: boolean) {
    mapStore.settings.transitLabels = value ?? !mapStore.settings.transitLabels
  }

  watch(
    () => mapStore.settings.transitLabels,
    value => {
      mapStrategy?.setTransitLabels(value)
    },
  )

  function togglePlaceLabels(value?: boolean) {
    mapStore.settings.placeLabels = value ?? !mapStore.settings.placeLabels
  }

  watch(
    () => mapStore.settings.placeLabels,
    value => {
      mapStrategy?.setPlaceLabels(value)
    },
  )

  function toggleHdRoads(value?: boolean) {
    mapStore.settings.hdRoads = value ?? !mapStore.settings.hdRoads
  }

  watch(
    () => mapStore.settings.hdRoads,
    value => {
      mapStrategy?.setHdRoads(value)
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

    const paddingResult = calculateMapPadding()

    if (!paddingResult) {
      console.warn('Cannot calculate map padding: invalid dimensions')
      return
    }

    // Apply the padding using flyTo for smooth transition
    mapStrategy.flyTo({
      padding: paddingResult.padding,
    })
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

  // Watch for language preference changes and update map labels
  watch(storedLocale, newLocale => {
    // Skip if we're currently reinitializing for a language change
    if (isReinitializingForLanguage) {
      return
    }

    if (mapStrategy) {
      const needsReinit = mapStrategy.setMapLanguage(newLocale)

      // If the map needs to be reinitialized (e.g., Mapbox Standard style),
      // reinitialize with the new language
      if (needsReinit) {
        const currentEngine = mapStore.settings.engine

        // Only get camera if map is ready, otherwise use stored camera
        if (isMapReady.value) {
          const currentCamera = {
            center: mapStrategy.mapInstance.getCenter(),
            zoom: mapStrategy.mapInstance.getZoom(),
            bearing: mapStrategy.mapInstance.getBearing(),
            pitch: mapStrategy.mapInstance.getPitch(),
          }
          mapStore.setMapCamera(currentCamera)
        }

        // Set flag to prevent watcher from firing during reinitialization
        isReinitializingForLanguage = true

        // Reinitialize the map with the new language
        setMapEngine(currentEngine)

        // Reset flag after reinitialization
        setTimeout(() => {
          isReinitializingForLanguage = false
        }, 100)
      }
    }
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
    () => mapStore.settings.basemap,
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

  // Watch for trip changes - handles route rendering
  // Note: Instruction markers are automatically managed by layers.service
  watch(
    () => directionsStore.trips,
    trips => {
      if (trips) {
        // Show the first trip by default (recommended or first in list)
        const firstTrip =
          trips.trips.find(trip => trip.isRecommended) || trips.trips[0]
        const defaultTripIds = firstTrip
          ? new Set([firstTrip.id])
          : new Set<string>()

        if (isMapReady.value && mapStrategy) {
          mapStrategy.setTrips(trips, defaultTripIds)
        } else {
          queuedTrips.value = { trips, visibleTripIds: defaultTripIds }
        }
      } else {
        if (mapStrategy) {
          mapStrategy.unsetTrips()
        }
        queuedTrips.value = null
      }
    },
  )

  // Note: selectedTripId changes are handled by setVisibleTrips(), showAllTrips(), 
  // and showOnlyWaypoints() which explicitly call mapStrategy.setTrips().
  // Instruction markers are automatically managed by marker-layers.service via its own watcher.

  function destroy() {
    // Reset state
    isMapReady.value = false
    queuedTrips.value = null
    isRotatedOrPitched.value = false
    isCurrentlyRotating.value = false
    isCurrentlyZooming.value = false

    // Clear any pending timeouts
    if (paddingUpdateTimeout) {
      clearTimeout(paddingUpdateTimeout)
      paddingUpdateTimeout = null
    }
    if (rotatingHideTimeout) {
      clearTimeout(rotatingHideTimeout)
      rotatingHideTimeout = null
    }
    if (zoomingHideTimeout) {
      clearTimeout(zoomingHideTimeout)
      zoomingHideTimeout = null
    }

    // Destroy marker layers
    markerLayersService.destroyMarkerLayers()

    // Clean up search results layer
    if (mapStrategy) {
      searchResultsLayerService.removeSearchResultsLayer(mapStrategy)
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

    // Update selectedTripId to trigger instruction markers update
    if (visibleTripIds.size === 1) {
      const [tripId] = visibleTripIds
      directionsStore.setSelectedTripId(tripId)
    } else {
      // Clear selected trip when showing multiple or no trips
      directionsStore.setSelectedTripId(null)
    }

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

    const allTripIds = new Set<string>(trips.trips.map(trip => trip.id))

    // Clear selected trip when showing all trips (no instruction markers)
    directionsStore.setSelectedTripId(null)

    if (isMapReady.value && mapStrategy) {
      mapStrategy.setTrips(trips, allTripIds)
    } else {
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
      mapStrategy.setTrips(trips, noTripIds)
      // Reset selected trip to null when showing only waypoints
      directionsStore.setSelectedTripId(null)
    } else {
      queuedTrips.value = { trips, visibleTripIds: noTripIds }
    }
  }

  /**
   * Show specific trip on hover (route line + instruction markers)
   */
  function showTripOnHover(tripId: string) {
    const trips = directionsStore.trips
    if (!trips) return

    setVisibleTrips([tripId])
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
    flyTo,
    jumpTo,
    fitBounds,
    setMapEngine,
    reinitializeMap,
    setMapProjection,
    toggle3dTerrain,
    toggle3dObjects,
    togglePoiLabels,
    toggleRoadLabels,
    toggleTransitLabels,
    togglePlaceLabels,
    toggleHdRoads,
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
      zIndex?: number,
      dragOptions?: {
        onDragEnd: (lngLat: LngLat) => void
        onDrag?: (lngLat: LngLat) => void
      },
    ) => mapStrategy?.addVueMarker(id, lngLat, component, props, zIndex, dragOptions),
    removeMarker: (id: string) => mapStrategy?.removeMarker(id),
    setMarkerLngLat: (id: string, lngLat: LngLat) =>
      mapStrategy?.setMarkerLngLat(id, lngLat),
    removeMarkersByPrefix: (prefix: string) =>
      mapStrategy?.removeMarkersByPrefix(prefix),
    removeAllMarkers: () => mapStrategy?.removeAllMarkers(),
    updatePlacePolygon: (place: Place | null) =>
      placePolygonLayerService.updatePlacePolygon(mapStrategy, place),
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
    // Expose mapStrategy for layers service
    get mapStrategy() {
      return mapStrategy
    },

    // Get current map bounds
    getBounds() {
      return mapStrategy?.getBounds() || null
    },

    // Get current map center
    getCenter() {
      return mapStrategy?.mapInstance?.getCenter() || null
    },

    // Get current map zoom level
    getZoom() {
      return mapStrategy?.mapInstance?.getZoom() || null
    },

    /** Project lng/lat to map container pixel coordinates (for measure tool hit testing). */
    project(lngLat: LngLat): { x: number; y: number } | null {
      const map = mapStrategy?.mapInstance
      if (!map?.project) return null
      const p = map.project([lngLat.lng, lngLat.lat])
      return p && typeof p.x === 'number' && typeof p.y === 'number' ? { x: p.x, y: p.y } : null
    },

    // Reactive state for conditional control visibility
    isRotatedOrPitched,
    isCurrentlyRotating,
    isCurrentlyZooming,

    // Instruction marker highlights (for UI interactions like hovering)
    // Delegated to marker layers service which manages marker layers
    highlightInstructionPoint: markerLayersService.highlightInstructionPoint,
    clearHighlightedInstructionPoint:
      markerLayersService.clearHighlightedInstructionPoint,
  }
}

export const useMapService = createSharedComposable(mapService)
