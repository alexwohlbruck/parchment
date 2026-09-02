import {
  Basemap,
  Layer,
  MapCamera,
  MapSettings,
  MapStyleId,
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

  /**
   * Hide the basemap's own transit POIs while a transit overlay draws its own.
   * MapLibre only — Mapbox Standard has no equivalent basemap layer to filter.
   */
  setBasemapTransitPoisVisible(_visible: boolean) {}
  setPlaceLabels(value: boolean) {}
  setLandmarkIcons(value: boolean) {}
  setMapProjection(projection: MapProjection) {}

  /**
   * Whether a sphere is on screen — not the same question as whether the globe
   * projection is selected. Both engines ease the globe into Mercator as you
   * zoom in, at zooms of their own, so a globe map is a flat map everywhere a
   * street is legible.
   *
   * Anything that only makes sense against a flat map asks this. False here
   * because a strategy with no globe never draws one.
   */
  isGlobeRendering(): boolean {
    return false
  }
  /**
   * Draw the top-down view orthographically rather than in perspective, so a
   * flat-on view has no vanishing point: building walls stop splaying outward
   * from the middle of the screen and a roof sits over its own footprint.
   * Perspective comes back once the camera is tilted.
   *
   * Each strategy subscribes to whatever it actually needs, because the two
   * engines need different upkeep: Mapbox has a real orthographic camera and
   * switches on pitch itself, but exposes it as a style property that a style
   * swap resets — so it re-applies on style load only. MapLibre 4 has no
   * orthographic camera and approximates one by narrowing the field of view,
   * which it has to undo when the map is tilted — so it also tracks pitch.
   */
  updateCameraProjection() {}
  setMap3dTerrain(value: boolean) {}
  /** Extrude the basemap's buildings. */
  setMap3dBuildings(value: boolean) {}
  /**
   * Draw the scene's repeated objects (trees, and later street furniture) as
   * models rather than as the flat marks that stand in for them. MapLibre only;
   * Mapbox Standard draws its own and has no hook for ours.
   */
  setMap3dObjects(value: boolean) {}
  /**
   * Light the 3D buildings — cast shadows on the ground, ambient occlusion in
   * the crease where a wall meets it, and a darkening band up the base of each
   * wall, so a block reads as separate buildings rather than one mass.
   *
   * Only MapLibre implements this. Mapbox Standard lights its buildings itself
   * and exposes `fill-extrusion-ambient-occlusion-*` for the rest; MapLibre has
   * no lighting model past a flat directional tint, so it draws the buildings
   * through a custom WebGL layer instead. Because the two arrive at the same
   * result by unrelated means, this stays a strategy method rather than
   * anything the style or the caller has to know about.
   */
  setBuildingShade(value: boolean) {}
  setMapTheme(theme: MapTheme) {}
  setMapColorTheme(theme: MapColorTheme) {}
  setBasemap(basemap: Basemap) {}
  setMapStyle(styleId: MapStyleId) {}
  setHdRoads(value: boolean) {}
  setIndoorMaps(value: boolean) {}
  setMapLanguage(locale: string): boolean {
    return false // Default: no reinitialization needed
  }
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
    // Geolocation is now handled by the centralized geolocation service.
    // See map.service.ts locate() which uses useGeolocationService().
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
    zIndex?: number,
    dragOptions?: {
      onDragEnd: (lngLat: LngLat) => void
      onDrag?: (lngLat: LngLat) => void
    },
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

  /** Update an existing marker's position without removing it (e.g. during drag of another marker). */
  setMarkerLngLat(id: string, lngLat: LngLat) {
    const marker = this.markers.get(id)
    if (marker && typeof marker.setLngLat === 'function') {
      marker.setLngLat(lngLat)
    }
  }

  /**
   * Rotate an existing marker to a compass heading without recreating it, and
   * toggle the `--heading-opacity` cue its element uses to show/hide the beam.
   * The marker is switched to `rotationAlignment: 'map'` so the heading stays
   * north-relative as the map rotates (pitch stays viewport-flat so the dot
   * doesn't distort when the map is tilted). `null` hides the beam.
   */
  setMarkerHeading(id: string, heading: number | null, spread = 1) {
    const marker = this.markers.get(id)
    if (!marker || typeof marker.setRotation !== 'function') return

    const element = marker.getElement?.()

    if (heading === null || Number.isNaN(heading)) {
      element?.style.setProperty('--heading-opacity', '0')
      return
    }

    if (typeof marker.setRotationAlignment === 'function') {
      marker.setRotationAlignment('map')
    }
    if (typeof marker.setPitchAlignment === 'function') {
      marker.setPitchAlignment('viewport')
    }
    marker.setRotation(heading)
    element?.style.setProperty('--beam-spread', String(spread))
    element?.style.setProperty('--heading-opacity', '1')
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

  hasMarker(id: string): boolean {
    return this.markers.has(id)
  }

  getMarkerCount(prefix?: string): number {
    if (!prefix) return this.markers.size
    return Array.from(this.markers.keys()).filter(id => id.startsWith(prefix)).length
  }

  removeMarkersByPrefix(prefix: string) {
    const markerIds = Array.from(this.markers.keys()).filter(id =>
      id.startsWith(prefix)
    )
    markerIds.forEach(id => this.removeMarker(id))
  }

  // Trip visualization methods
  setTrips(trips: TripsResponse, visibleTripIds: Set<string>) {}
  unsetTrips() {}
  setRouteProfile(profile: import('@/lib/route-profile-colors').RouteProfileType | null) {}
  setSegmentRouteProfile(
    tripId: string,
    segmentIndex: number,
    profile: import('@/lib/route-profile-colors').RouteProfileType | null,
  ) {}
}
