import {
  Basemap,
  Layer,
  MapCamera,
  MapSettings,
  MapProjection,
  MapTheme,
  MapColorTheme,
  Pegman,
  LngLat,
  Waypoint,
} from '@/types/map.types'
import { Directions, TripsResponse } from '@/types/directions.types'
import { Component } from 'vue'
import { destroyVueMarkerElement } from '@/lib/vue-marker.utils'
import WaypointMapIcon from '@/components/map/WaypointMapIcon.vue'
import { mapEventBus } from '@/lib/eventBus'
import { impactFeedback } from '@tauri-apps/plugin-haptics'

export class MapStrategy {
  mapInstance: any
  container: HTMLElement
  options: MapSettings
  accessToken?: string
  markers: Map<string, any> = new Map() // Track active markers
  protected longPressTimer: ReturnType<typeof setTimeout> | null = null
  protected touchStartPoint: { x: number; y: number } | null = null

  constructor(container, options: MapSettings, accessToken?: string) {
    this.container = container
    this.options = options
    this.accessToken = accessToken
  }

  /**
   * Sets up touch-and-hold gesture to trigger context menu on mobile.
   * Should be called from configureEventListeners() in child classes after mapInstance is initialized.
   */
  protected setupLongPressHandler() {
    const LONG_PRESS_DURATION = 500 // ms
    const MOVE_THRESHOLD = 10 // pixels

    const canvas = this.mapInstance.getCanvas()

    const clearLongPress = () => {
      if (this.longPressTimer) {
        clearTimeout(this.longPressTimer)
        this.longPressTimer = null
      }
      this.touchStartPoint = null
    }

    const handleTouchStart = (e: TouchEvent) => {
      // Only handle single finger touch
      if (e.touches.length !== 1) {
        clearLongPress()
        return
      }

      const touch = e.touches[0]
      this.touchStartPoint = { x: touch.clientX, y: touch.clientY }

      this.longPressTimer = setTimeout(async () => {
        if (this.touchStartPoint) {
          const rect = canvas.getBoundingClientRect()
          const x = this.touchStartPoint.x - rect.left
          const y = this.touchStartPoint.y - rect.top

          // Convert pixel coordinates to lng/lat
          const lngLat = this.mapInstance.unproject([x, y])

          // Trigger haptic feedback on mobile
          try {
            await impactFeedback('medium')
          } catch {
            // Haptics not available (e.g., web/desktop)
          }

          mapEventBus.emit('contextmenu', {
            lngLat,
            point: { x, y },
          })
        }
        this.longPressTimer = null
      }, LONG_PRESS_DURATION)
    }

    const handleTouchMove = (e: TouchEvent) => {
      if (!this.longPressTimer || !this.touchStartPoint) return

      const touch = e.touches[0]
      const dx = touch.clientX - this.touchStartPoint.x
      const dy = touch.clientY - this.touchStartPoint.y
      const distance = Math.sqrt(dx * dx + dy * dy)

      // Cancel if finger moved too much (user is panning)
      if (distance > MOVE_THRESHOLD) {
        clearLongPress()
      }
    }

    const handleTouchEnd = () => {
      clearLongPress()
    }

    // Prevent default browser context menu on long-press
    canvas.addEventListener('contextmenu', (e: Event) => {
      e.preventDefault()
    })

    canvas.addEventListener('touchstart', handleTouchStart)
    canvas.addEventListener('touchmove', handleTouchMove)
    canvas.addEventListener('touchend', handleTouchEnd)
    canvas.addEventListener('touchcancel', handleTouchEnd)
  }

  resize() {}
  addDataSource() {}
  flyTo(camera: Partial<MapCamera>) {}
  jumpTo(camera: Partial<MapCamera>) {}
  fitBounds(
    bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number },
    options?: any,
  ) {}
  setDirections(directions: Directions) {}
  unsetDirections() {}
  setPegman(pegman: Pegman) {}
  removePegman() {}
  setPoiLabels(value: boolean) {}
  setRoadLabels(value: boolean) {}
  setTransitLabels(value: boolean) {}
  setPlaceLabels(value: boolean) {}
  setLandmarkIcons(value: boolean) {}
  setMapProjection(projection: MapProjection) {}
  setMap3dTerrain(value: boolean) {}
  setMap3dObjects(value: boolean) {}
  setMapTheme(theme: MapTheme) {}
  setMapColorTheme(theme: MapColorTheme) {}
  setBasemap(basemap: Basemap) {}
  addSource(sourceId: string, source: any) {}
  removeSource(sourceId: string) {}
  addLayer(layer: Layer, overwrite: boolean = false) {}
  removeLayer(layerId: Layer['configuration']['id']) {}
  updateLayer(layerId: Layer['configuration']['id'], updates: Partial<Layer>) {}
  toggleLayer(layerId: string, state?: boolean) {}
  toggleLayerVisibility(
    layerId: Layer['configuration']['id'],
    state?: boolean,
  ) {}
  destroy() {}
  locate() {
    if (!navigator.geolocation) {
      console.error('Geolocation is not supported by your browser')
      return
    }

    navigator.geolocation.getCurrentPosition(
      position => {
        this.flyTo({
          center: [position.coords.longitude, position.coords.latitude],
          zoom: 16,
        })
      },
      error => {
        console.error('Error getting location:', error)
      },
      {
        enableHighAccuracy: true,
      },
    )
  }

  zoomIn() {}
  zoomOut() {}
  resetNorth() {}

  getBounds(): {
    north: number
    south: number
    east: number
    west: number
  } | null {
    // This method should be overridden by specific implementations
    return null
  }

  addMarker(id: string, lngLat: LngLat) {}

  addVueMarker(
    id: string,
    lngLat: LngLat,
    component: Component,
    props: Record<string, any> = {},
  ) {}

  removeMarker(id: string) {
    const marker = this.markers.get(id)
    if (marker) {
      if (marker.getElement) {
        const element = marker.getElement()
        destroyVueMarkerElement(element)
      }
      marker.remove()
      this.markers.delete(id)
    }
  }

  removeAllMarkers() {
    this.markers.forEach(marker => {
      if (marker.getElement) {
        const element = marker.getElement()
        destroyVueMarkerElement(element)
      }
      marker.remove()
    })
    this.markers.clear()
  }

  // Trip visualization methods
  setTrips(trips: TripsResponse, visibleTripIds: Set<string>) {}
  unsetTrips() {}

  // Waypoint marker methods (separate from trip routes)
  setWaypointMarkers(waypoints: Waypoint[]) {
    // Remove existing waypoint markers
    this.clearWaypointMarkers()

    // Add new waypoint markers for all waypoints with coordinates
    waypoints.forEach((waypoint, index) => {
      if (waypoint.lngLat) {
        this.addVueMarker(
          `waypoint-${index}`,
          waypoint.lngLat,
          WaypointMapIcon,
          {
            index,
            totalWaypoints: waypoints.length,
            type:
              index === 0
                ? 'origin'
                : index === waypoints.length - 1
                ? 'destination'
                : 'waypoint',
          },
        )
      }
    })
  }

  clearWaypointMarkers() {
    // Remove waypoint markers
    const waypointMarkerIds = Array.from(this.markers.keys()).filter(id =>
      id.startsWith('waypoint-'),
    )
    waypointMarkerIds.forEach(id => this.removeMarker(id))
  }

  unsetWaypointMarkers() {
    this.clearWaypointMarkers()
  }
}
