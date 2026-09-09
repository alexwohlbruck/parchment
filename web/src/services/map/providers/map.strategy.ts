import { LngLatBounds, type CameraOptions } from 'maplibre-gl'
import {
  TERRAIN_SOURCE_ID,
  TERRAIN_EXAGGERATION,
  terrainSource,
} from '@/lib/map-style/terrain'
import { MapLayerGroup, TripGroup } from '@/services/map/providers/layer-group'
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
import { destroyVueMarkerElement } from '@/lib/map/vue-marker'
import { mapEventBus } from '@/lib/event-bus'
import { impactFeedback } from '@tauri-apps/plugin-haptics'
import {
  mapPoiClickPolicy,
  PoiTapController,
  type PoiPointerEvent,
} from '@/lib/map/map-poi-interaction'

export class MapStrategy {
  mapInstance: any
  container: HTMLElement
  options: MapSettings
  accessToken?: string
  markers: Map<string, any> = new Map() // Track active markers
  layerGroups: Map<string, MapLayerGroup> = new Map()
  protected fitMapToTrips(_trips: TripsResponse, _visibleTripIds: Set<string>) {}
  protected longPressTimer: ReturnType<typeof setTimeout> | null = null
  protected touchStartPoint: { x: number; y: number } | null = null
  protected clickDebounceTimer: number | null = null
  private poiTapController: PoiTapController | null = null
  private cancelPendingDoubleTapZoom = (event: {
    originalEvent?: { type?: string; touches?: { length: number } }
  }) => {
    const touchEvent = event.originalEvent
    if (touchEvent?.type !== 'touchmove' || touchEvent.touches?.length !== 1) {
      return
    }

    const doubleClickZoom = this.mapInstance?.doubleClickZoom
    if (!doubleClickZoom?.isEnabled?.()) return

    doubleClickZoom.disable()
    doubleClickZoom.enable()
  }

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

  /** Attach the shared single/double/drag tap recognizer after map creation. */
  protected setupPoiClickHandling() {
    this.poiTapController?.destroy()
    this.mapInstance.off?.('zoomstart', this.cancelPendingDoubleTapZoom)
    const element = this.mapInstance.getCanvasContainer?.()
      ?? this.mapInstance.getCanvas()
    this.poiTapController = new PoiTapController(element)
    this.mapInstance.on?.('zoomstart', this.cancelPendingDoubleTapZoom)
  }

  /**
   * Run a place-like map action through the shared policy and tap recognizer.
   * False leaves the generic map click available to a drawing/capture tool.
   */
  dispatchPoiClick(
    event: PoiPointerEvent,
    action: () => void,
    prefetch?: () => void,
  ) {
    if (!mapPoiClickPolicy.enabled) return false
    if (!this.poiTapController) {
      action()
      this.cancelPendingMapClick()
      return true
    }
    const accepted = this.poiTapController.handle(event, action, prefetch)
    if (accepted) this.cancelPendingMapClick()
    return accepted
  }

  protected destroyPoiClickHandling() {
    this.cancelPendingMapClick()
    this.mapInstance?.off?.('zoomstart', this.cancelPendingDoubleTapZoom)
    this.poiTapController?.destroy()
    this.poiTapController = null
  }

  private cancelPendingMapClick() {
    if (this.clickDebounceTimer) clearTimeout(this.clickDebounceTimer)
    this.clickDebounceTimer = null
  }

  addDataSource() {}
  setDirections(directions: Directions) {}
  setPegman(pegman: Pegman) {}
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
   * Whether the sphere reads as an OBJECT — a disc with an edge and an
   * obvious centre — rather than merely being drawn by the globe render
   * path. The two part ways on MapLibre, which keeps easing the globe into
   * Mercator until street zooms: at z8 its render path is still spherical,
   * but the screen shows what anyone would call a flat map.
   *
   * Padding asks this one. Moving the focal point off-centre is invisible on
   * a map that covers the canvas, and glaring on a disc — so padding is
   * dropped only while a disc is what the rider sees. Keying it on the
   * render path instead made MapLibre's padding snap on and off at z12,
   * shifting the map sideways on an ordinary city zoom.
   */
  isSphereVisible(): boolean {
    return this.isGlobeRendering()
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
  /**
   * Replace a live GeoJSON source's data without touching the layers drawn
   * from it — the cheap path for content that changes while you work.
   */
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


  getBounds(): {
    north: number
    south: number
    east: number
    west: number
  } | null {
    const bounds = this.mapInstance?.getBounds()
    if (!bounds) return null
    return {
      north: bounds.getNorth(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      west: bounds.getWest(),
    }
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
  fitBounds(
    bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number },
    options: any = {},
  ) {
    const mapboxBounds = new LngLatBounds(
      [bounds.minLng, bounds.minLat],
      [bounds.maxLng, bounds.maxLat],
    )

    this.mapInstance.fitBounds(mapboxBounds, {
      padding: options.padding || 100,
      duration: options.duration || 1000,
      easing: options.easing || (t => t * (2 - t)),
      ...options,
    })
  }

  flyTo(camera: Partial<CameraOptions>) {
    this.mapInstance.flyTo(camera)
  }

  jumpTo(camera: Partial<CameraOptions>) {
    this.mapInstance.jumpTo(camera)
  }

  removePegman() {
    // Remove pegman layers if they exist
    if (this.mapInstance.getLayer('pegman-fov')) {
      this.mapInstance.removeLayer('pegman-fov')
    }
    if (this.mapInstance.getLayer('pegman-position')) {
      this.mapInstance.removeLayer('pegman-position')
    }
    if (this.mapInstance.getSource('pegman')) {
      this.mapInstance.removeSource('pegman')
    }
  }

  removeSource(sourceId: string) {
    if (this.mapInstance.getSource(sourceId)) {
      this.mapInstance.removeSource(sourceId)
    }
  }

  resetNorth() {
    this.mapInstance.easeTo({
      bearing: 0,
      pitch: 0,
    })
  }

  resize() {
    this.mapInstance.resize()
  }

  setMap3dTerrain(value: boolean) {
    const present = !!this.mapInstance.getSource(TERRAIN_SOURCE_ID)
    if (value && !present) {
      this.mapInstance.addSource(TERRAIN_SOURCE_ID, terrainSource() as any)
      this.mapInstance.setTerrain({
        source: TERRAIN_SOURCE_ID,
        exaggeration: TERRAIN_EXAGGERATION,
      })
    } else if (!value && present) {
      // Order matters: a source still referenced by the terrain cannot be
      // removed, so the terrain has to be cleared first.
      this.mapInstance.setTerrain(null)
      this.mapInstance.removeSource(TERRAIN_SOURCE_ID)
    }
  }

  setRouteProfile(profile: import('@/lib/directions/route-profile-colors').RouteProfileType | null) {
    for (const [groupId, group] of this.layerGroups.entries()) {
      if (groupId.startsWith('trip-') && group instanceof TripGroup) {
        group.setRouteProfile(profile)
      }
    }
  }

  setSegmentRouteProfile(
    tripId: string,
    segmentIndex: number,
    profile: import('@/lib/directions/route-profile-colors').RouteProfileType | null,
  ) {
    const group = this.layerGroups.get(`trip-${tripId}`)
    if (group instanceof TripGroup) {
      group.setSegmentRouteProfile(segmentIndex, profile)
    }
  }

  setSourceData(sourceId: string, data: any) {
    // Only a GeoJSON source can take data in place; anything else is a no-op.
    const source = this.mapInstance.getSource(sourceId) as
      | { setData?: (data: any) => void }
      | undefined
    source?.setData?.(data)
  }

  setTrips(trips: TripsResponse, visibleTripIds: Set<string>) {
    // Idempotent: if we already show exactly these trips, skip destroy+recreate
    const currentTripIds = new Set(
      [...this.layerGroups.keys()]
        .filter(k => k.startsWith('trip-'))
        .map(k => k.slice('trip-'.length)),
    )
    if (
      currentTripIds.size === visibleTripIds.size &&
      [...visibleTripIds].every(id => currentTripIds.has(id))
    ) {
      return
    }

    for (const groupId of this.layerGroups.keys()) {
      if (groupId.startsWith('trip-')) {
        this.layerGroups.get(groupId)?.destroy()
        this.layerGroups.delete(groupId)
      }
    }

    const visibleTrips: any[] = []
    trips.trips.forEach(trip => {
      if (visibleTripIds.has(trip.id)) {
        const groupId = `trip-${trip.id}`
        const tripGroup = new TripGroup(this, trip)
        this.layerGroups.set(groupId, tripGroup)
        visibleTrips.push(trip)
      }
    })

    if (visibleTripIds.size > 0) {
      this.fitMapToTrips(trips, visibleTripIds)
    }
  }

  unsetDirections() {
    const style = this.mapInstance.getStyle()
    if (!style) return
    const mapLayers = style.layers
    const ids = mapLayers.map(layer => layer.id)

    // Remove route layers
    ids.forEach(id => {
      if (id.startsWith('route-')) {
        this.mapInstance.removeLayer(id)
      }
    })

    // Remove route sources
    const sources = Object.keys(this.mapInstance.getStyle()?.sources || {})
    sources.forEach(source => {
      if (source.startsWith('route-')) {
        this.mapInstance.removeSource(source)
      }
    })

    // Remove route stop markers
    const markersToRemove = Array.from(this.markers.keys()).filter(id =>
      id.startsWith('route-stop-'),
    )
    markersToRemove.forEach(id => this.removeMarker(id))
  }

  unsetTrips() {
    for (const groupId of this.layerGroups.keys()) {
      if (groupId.startsWith('trip-')) {
        this.layerGroups.get(groupId)?.destroy()
        this.layerGroups.delete(groupId)
      }
    }
  }

  zoomIn() {
    this.mapInstance.zoomIn()
  }

  zoomOut() {
    this.mapInstance.zoomOut()
  }

}
