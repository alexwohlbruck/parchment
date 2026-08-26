import { MapStrategy } from './map.strategy'
import {
  Map as MaplibreMap,
  NavigationControl,
  GeolocateControl,
  AttributionControl,
  ScaleControl,
  LngLatBounds,
  LngLatLike,
  Marker,
  GeoJSONSource,
  LngLat as MaplibreLngLat,
  CameraOptions,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  Basemap,
  MapTheme,
  MapStyleId,
  PoiStyleId,
  MapSettings,
  Layer,
  MapCamera,
  Pegman,
  MapillaryImage,
  MapProjection,
  LngLat,
  Waypoint,
  LayerType,
} from '@/types/map.types'

import { Directions, TripsResponse } from '@/types/directions.types'
import { decodeShape } from '@/lib/utils'
import { palette } from '@/lib/palette'
import { mapEventBus } from '@/lib/eventBus'
import {
  mapboxLayerToMaplibreLayer,
  parsePlanetilerOsmId,
} from '@/lib/map.utils'
import { useMapStore } from '@/stores/map.store'
import { useMapToolsStore } from '@/stores/map-tools.store'
import { createPegmanLayers, updatePegmanData } from '@/lib/pegman.utils'
import { MapLayerGroup, TripGroup } from '@/lib/layer-group'
import { Component, watch } from 'vue'
import { createVueMarkerElement } from '@/lib/vue-marker.utils'
import WaypointMapIcon from '@/components/map/WaypointMapIcon.vue'
import InstructionPointMarker from '@/components/map/InstructionPointMarker.vue'
import { useAppStore } from '@/stores/app.store'
import { calculateFitPadding } from '@/lib/map-padding'
import { useThemeStore } from '@/stores/theme.store'
import { useCategoryPaletteStore } from '@/stores/category-palette.store'
import {
  buildMapStyle,
  buildSatelliteStyle,
  layerGroups,
  BUILDING_HEIGHT_PROPERTY,
  BUILDING_MIN_HEIGHT_PROPERTY,
} from '@/lib/map-style'
import {
  rgbToHex,
  adjustLightness,
} from '@/lib/utils'
function getPrimaryThemeHex(): string {
  try {
    const span = document.createElement('span')
    span.style.position = 'absolute'
    span.style.left = '-9999px'
    span.className = 'text-primary'
    document.body.appendChild(span)
    const color = getComputedStyle(span).color
    document.body.removeChild(span)
    return rgbToHex(color)
  } catch {
    return '#04CB63'
  }
}

function buildStreetViewPaint(configuration: any) {
  const primary = getPrimaryThemeHex()
  const fill = adjustLightness(primary, 8)
  const stroke = adjustLightness(primary, -18)
  const paint: any = { ...(configuration?.paint || {}) }
  if (configuration.type === 'circle') {
    paint['circle-color'] = fill
    paint['circle-opacity'] = paint['circle-opacity'] ?? 0.85
    paint['circle-stroke-color'] = stroke
    paint['circle-stroke-width'] = paint['circle-stroke-width'] ?? 1.5
    paint['circle-stroke-opacity'] = paint['circle-stroke-opacity'] ?? 0.9
    paint['circle-emissive-strength'] = paint['circle-emissive-strength'] ?? 1
  }
  if (configuration.type === 'line') {
    paint['line-color'] = stroke
    paint['line-opacity'] = paint['line-opacity'] ?? 0.8
    paint['line-emissive-strength'] = paint['line-emissive-strength'] ?? 1
  }
  return paint
}

function applyThemedStreetViewStyling(layer: Layer): Layer {
  if (layer.type !== LayerType.STREET_VIEW) return layer
  const cloned: Layer = JSON.parse(JSON.stringify(layer))
  cloned.configuration.paint = buildStreetViewPaint(cloned.configuration)
  return cloned
}

/**
 * How close to flat still counts as top-down. Small enough that any pitch a
 * user can perceive falls outside it.
 */
const TOP_DOWN_EPSILON = 0.001

/** Narrow enough to be indistinguishable from a true orthographic camera. */
const ORTHO_FOV = 0.5

/** Below this pitch the buildings are flat; above `FULL`, at full height. */
const BUILDING_FLAT_PITCH = 1
const BUILDING_FULL_PITCH = 25

/**
 * How much zoom the buildings take to grow in, past the layer's own minzoom.
 * Short, so they are at full height almost as soon as they appear rather than
 * spending a whole level looking stunted.
 */
const BUILDING_GROW_ZOOM = 0.4

/** Fallback for the building layer's own minzoom, if it ever loses one. */
const BUILDING_MIN_ZOOM = 15

/** Height scale is snapped to this, to cut the number of re-evaluations. */
const BUILDING_SCALE_STEP = 0.2

/** The layer's own height and base, before the pitch ramp scales them. */
const BUILDING_HEIGHT = ['coalesce', ['get', BUILDING_HEIGHT_PROPERTY], 0]
const BUILDING_BASE = ['coalesce', ['get', BUILDING_MIN_HEIGHT_PROPERTY], 0]

export class MaplibreStrategy extends MapStrategy {
  mapInstance: MaplibreMap
  geolocateControl: GeolocateControl
  layerGroups: Map<string, MapLayerGroup> = new Map()
  private streetViewLayerIds: Set<string> = new Set()
  private unwatchTheme?: () => void
  private tileServerUrl?: string
  private tileKey?: string
  private currentBasemap: Basemap = 'standard'
  private clickDebounceTimer: number | null = null
  private poiHandlerCleanup: (() => void) | null = null

  constructor(
    container: string | HTMLElement,
    options: MapSettings,
    accessToken?: string,
    tileServerUrl?: string,
    tileKey?: string,
  ) {
    super(container, options, accessToken)
    this.tileServerUrl = tileServerUrl
    this.tileKey = tileKey
    // Seed currentBasemap from the persisted map settings so that engine
    // swaps preserve satellite/hybrid mode. Without this, a fresh strategy
    // instance always started on 'standard' and only picked up the real
    // basemap after the user re-toggled it.
    this.currentBasemap = options.basemap ?? 'standard'
    const { center, zoom, bearing, pitch } = options.camera || {}

    this.mapInstance = new MaplibreMap({
      container,
      style: this.buildCurrentStyle(),
      center: center as LngLatLike,
      bearing,
      pitch,
      zoom,
      attributionControl: false,
      // Disable the engine's built-in north snap — we do north + grid snapping
      // ourselves in map.service (snapRotation) so both settings toggle live.
      bearingSnap: 0,
      transformRequest: (url, resourceType) => {
        // Add auth header for tile requests to the barrelman tile proxy
        if (
          this.tileKey &&
          this.tileServerUrl &&
          url.startsWith(this.tileServerUrl)
        ) {
          return {
            url,
            headers: {
              Authorization: `Bearer ${this.tileKey}`,
            },
          }
        }
        return { url }
      },
    })

    // Add geolocate control but hide it off-screen
    this.geolocateControl = new GeolocateControl({
      positionOptions: {
        enableHighAccuracy: true,
      },
      trackUserLocation: true,
      showUserLocation: true,
      showAccuracyCircle: true,
    })

    this.addControls()
    this.configureEventListeners()

    const theme = useThemeStore()
    this.unwatchTheme = watch(
      () => theme.accentColor,
      () => this.updateStreetViewColors(),
    )
  }

  addControls() {
    // Dev only: the map is otherwise unreachable from the console, which
    // makes every rendering question a guess instead of a check.
    if (import.meta.env.DEV) (window as any).__parchmentMap = this.mapInstance

    this.mapInstance.addControl(
      new AttributionControl({
        compact: true,
      }),
      'bottom-left',
    )
    this.mapInstance.addControl(this.geolocateControl, 'top-left')
  }

  configureEventListeners() {
    this.mapInstance.on('load', () => {
      mapEventBus.emit('load', this.mapInstance)
    })
    this.mapInstance.on('pitch', () => {
      this.scheduleBuildingHeights()
      this.updateCameraProjection()
    })
    // Style load fires on the initial style load AND on every subsequent
    // setStyle() call (theme change, basemap change, map style change). We
    // use this single listener to re-emit to the mapEventBus so that
    // map.service re-registers all custom layers after the style is replaced.
    //
    // Note: setupPoiHandlers() is idempotent — it early-returns if handlers
    // are already attached, because MapLibre's layer-scoped delegates use
    // getLayer() on each event and automatically adapt to style changes.
    this.mapInstance.on('style.load', () => {
      this.setupPoiHandlers()
      this.lastHeightScale = undefined
      this.updateBuildingHeights()
      this.updateCameraProjection()
      mapEventBus.emit('style.load', this.mapInstance)
    })
    this.mapInstance.on('move', () => {
      mapEventBus.emit('move', {
        center: this.mapInstance.getCenter(),
        zoom: this.mapInstance.getZoom(),
        bearing: this.mapInstance.getBearing(),
        pitch: this.mapInstance.getPitch(),
      })
    })
    this.mapInstance.on('moveend', () => {
      mapEventBus.emit('moveend', {
        center: this.mapInstance.getCenter(),
        zoom: this.mapInstance.getZoom(),
        bearing: this.mapInstance.getBearing(),
        pitch: this.mapInstance.getPitch(),
      })
    })
    // Surface user-driven rotation gestures so the service can apply the
    // city-grid orientation snap. Programmatic camera moves (compass-drag
    // jumpTo, the snap easeTo itself) carry no originalEvent — skip them so we
    // only snap when the user finishes rotating by hand, and never loop.
    this.mapInstance.on('rotateend', (e: any) => {
      if (!e?.originalEvent) return
      mapEventBus.emit('rotateend', {
        center: this.mapInstance.getCenter(),
        zoom: this.mapInstance.getZoom(),
        bearing: this.mapInstance.getBearing(),
        pitch: this.mapInstance.getPitch(),
      })
    })
    this.mapInstance.on('click', e => {
      // Debounce to allow POI click handler to fire first and cancel this
      if (this.clickDebounceTimer) {
        clearTimeout(this.clickDebounceTimer)
      }

      this.clickDebounceTimer = window.setTimeout(() => {
        mapEventBus.emit('click', {
          lngLat: e.lngLat,
          point: e.point,
        })
        this.clickDebounceTimer = null
      }, 50)
    })
    this.mapInstance.on('contextmenu', e => {
      e.preventDefault()
      mapEventBus.emit('contextmenu', {
        lngLat: e.lngLat,
        point: e.point,
      })
    })

    // Touch-and-hold for mobile context menu
    this.setupLongPressHandler()
    this.mapInstance.on('click', 'mapillary-image', e => {
      mapEventBus.emit('click:mapillary-image', {
        lngLat: e.lngLat,
        point: e.point,
        image: (e.features?.[0]?.properties as MapillaryImage) || undefined,
      })
    })
    // Change pointers on hover
    this.mapInstance.on('mouseenter', 'mapillary-image', () => {
      this.mapInstance.getCanvas().style.cursor = 'pointer'
    })
    this.mapInstance.on('mouseleave', 'mapillary-image', () => {
      this.mapInstance.getCanvas().style.cursor = ''
    })
  }

  resize() {
    this.mapInstance.resize()
  }

  flyTo(camera: Partial<CameraOptions>) {
    this.mapInstance.flyTo(camera)
  }

  jumpTo(camera: Partial<CameraOptions>) {
    this.mapInstance.jumpTo(camera)
  }

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

  setDirections(directions: Directions) {
    this.unsetDirections()

    directions.legs.forEach((leg, index) => {
      const shape = decodeShape(leg.shape)

      this.mapInstance.addSource(`route-${index}`, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: shape.map(([lat, lon]) => [lon, lat]),
          },
        },
      })

      this.mapInstance.addLayer({
        id: `route-case-${index}`,
        type: 'line',
        source: `route-${index}`,
        slot: 'middle',
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': palette.forest[600],
          'line-width': 8,
          'line-emissive-strength': 1,
          'line-occlusion-opacity': 0.5,
        },
      } as any)

      this.mapInstance.addLayer({
        id: `route-${index}`,
        type: 'line',
        source: `route-${index}`,
        slot: 'middle',
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': palette.forest[400],
          'line-width': 5,
          'line-emissive-strength': 1,
          'line-occlusion-opacity': 0.5,
        },
      } as any)
    })

    // Add Vue component markers for each stop instead of circle layers
    directions.locations.forEach((location, index) => {
      this.addVueMarker(
        `route-stop-${index}`,
        { lat: location.lat, lng: location.lon },
        WaypointMapIcon,
        {
          index,
          totalWaypoints: directions.locations.length,
          type:
            index === 0
              ? 'origin'
              : index === directions.locations.length - 1
                ? 'destination'
                : 'waypoint',
        },
      )
    })

    // Get all route coordinates
    const allCoordinates: mapboxgl.LngLatLike[] = directions.legs.flatMap(
      leg => {
        const shape = decodeShape(leg.shape)
        return shape.map(([lat, lon]) => [lon, lat] as mapboxgl.LngLatLike)
      },
    )

    // Create a bounds object that encompasses all coordinates
    const bounds = allCoordinates.reduce(
      (bounds, coord) => {
        return bounds.extend(coord)
      },
      new LngLatBounds(allCoordinates[0], allCoordinates[0]),
    )

    // Fit the map to show the entire route with padding
    this.mapInstance.fitBounds(bounds, {
      padding: Math.min(window.innerWidth * 0.2, 400),
      duration: 400,
      easing: t => t * (2 - t),
      bearing: this.mapInstance.getBearing(), // Preserve current bearing
    })
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

  setPegman(pegman: Pegman) {
    if (!this.mapInstance.getSource('pegman')) {
      createPegmanLayers(this.mapInstance, false)
    }
    const source = this.mapInstance.getSource('pegman') as GeoJSONSource
    if (source) {
      source.setData(updatePegmanData({ ...pegman, visible: true }))
    }
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

  setPoiLabels(value: boolean) {
    this.setLayerGroupVisibility(layerGroups.poi, value)
  }

  setRoadLabels(value: boolean) {
    this.setLayerGroupVisibility(layerGroups.roadLabels, value)
  }

  setTransitLabels(value: boolean) {
    this.setLayerGroupVisibility(layerGroups.transit, value)
  }

  setPlaceLabels(value: boolean) {
    this.setLayerGroupVisibility(layerGroups.placeLabels, value)
  }

  setMap3dTerrain(_value: boolean) {
    // TODO: Need to find a free 3D DEM source
  }

  setMap3dObjects(value: boolean) {
    const buildingLayerId = layerGroups.building3d
    if (!this.mapInstance.getLayer(buildingLayerId)) return

    if (value) {
      // Through the ramp, not straight to full height: switching 3D back on
      // while the map is flat should leave the buildings flat, not stand a
      // city up under a top-down camera. The remembered scale is cleared so
      // the update cannot be mistaken for a repeat and skipped.
      this.lastHeightScale = undefined
      this.updateBuildingHeights()
    } else {
      this.mapInstance.setPaintProperty(
        buildingLayerId,
        'fill-extrusion-height',
        0,
      )
      this.mapInstance.setPaintProperty(
        buildingLayerId,
        'fill-extrusion-base',
        0,
      )
    }
  }

  private setLayerGroupVisibility(layerIds: string[], visible: boolean) {
    layerIds.forEach(id => {
      if (this.mapInstance.getLayer(id)) {
        this.mapInstance.setLayoutProperty(
          id,
          'visibility',
          visible ? 'visible' : 'none',
        )
      }
    })
  }

  getBasemapFromTheme() {
    if (!this.tileServerUrl) {
      // Fallback: minimal empty style when no tile server is configured
      return { version: 8 as const, sources: {}, layers: [] }
    }
    const theme = this.options.theme === 'dark' ? 'dark' : 'light'
    return buildMapStyle({
      tileServerUrl: this.tileServerUrl,
      theme,
      tileKey: this.tileKey,
      mapStyle: this.options.mapStyle,
      poiStyle: this.poiStyle(),
      categoryColors: this.categoryColors(theme),
    })
  }

  setMapTheme(theme: MapTheme) {
    this.options.theme = theme
    this.reloadStyle()
  }

  setBasemap(basemap: Basemap) {
    this.currentBasemap = basemap
    this.reloadStyle()
  }

  setMapStyle(styleId: MapStyleId) {
    this.options.mapStyle = styleId
    this.reloadStyle()
  }

  /**
   * Swap the map style and fire style.load so downstream services can
   * re-register their custom layers.
   *
   * CRITICAL: we pass `{ diff: false }` to force a full style replacement.
   * MapLibre's default diff mode compares the old style against the new one
   * and issues `removeLayer`/`removeSource` operations for anything that
   * isn't in the new style — which silently wipes every layer we added
   * manually (bicycle, transit, mapillary, …) without firing `style.load`.
   * With `diff: false` a brand-new Style is created, which reliably fires
   * `style.load` and lets our re-registration pipeline run.
   */
  /**
   * POI tints for the basemap, taken from the same server-synced palette the
   * search results use — so a café pinned by a search and the same café drawn
   * by the basemap are the same colour.
   */
  private categoryColors(theme: 'light' | 'dark') {
    const store = useCategoryPaletteStore()
    const isDark = theme === 'dark'
    return Object.fromEntries(
      store.palette.map(c => [c.id, isDark ? c.colors.dark : c.colors.light]),
    )
  }

  /**
   * Which POI treatment to draw. Read at style-build time rather than held on
   * `options`, so a change to the setting takes effect on the next reload
   * without having to be threaded through the strategy's constructor.
   */
  private poiStyle(): PoiStyleId {
    return useMapStore().settings.poiStyle ?? 'badge'
  }

  /**
   * MapLibre 4 has no orthographic camera (`setVerticalFieldOfView` is v5, and
   * even that is the same trick behind a nicer name), so this narrows the
   * field of view instead. A perspective frustum approaches an orthographic
   * box as the FOV approaches zero and the camera retreats to compensate,
   * which MapLibre does implicitly — 0.5° puts the camera ~80,000 units out
   * and flattens the walls away entirely. It is an approximation, not a true
   * orthographic matrix, but at this angle the two are indistinguishable.
   *
   * Applied only when the map is perfectly flat on. Any pitch at all, however
   * slight, gets the real perspective camera back — the flattening is meant
   * for the plan view, and a near-zero FOV on a tilted map would rob it of the
   * depth that makes the tilt worth having.
   */
  override updateCameraProjection() {
    const transform = this.mapInstance.transform as { fov: number }
    if (this.defaultFov === undefined) this.defaultFov = transform.fov

    // Not `=== 0`: an eased pitch animation can settle a hair off zero, and
    // the view is still flat on at a thousandth of a degree.
    const topDown = Math.abs(this.mapInstance.getPitch()) < TOP_DOWN_EPSILON
    const wanted = topDown ? ORTHO_FOV : this.defaultFov
    // `pitch` fires continuously through a gesture; setting the field of view
    // recomputes every matrix, so only touch it when the answer changes.
    if (Math.abs(transform.fov - wanted) < 0.001) return
    transform.fov = wanted
  }

  /**
   * How tall the buildings stand at a given pitch: flat below
   * `BUILDING_FLAT_PITCH`, full height above `BUILDING_FULL_PITCH`, ramped in
   * between.
   *
   * This is what keeps the camera switch invisible. The buildings are already
   * flat a degree before the map reaches top-down, so by the time the field of
   * view narrows there are no walls left to pop out of existence — no
   * sequencing, no animation timer, and the collapse follows the gesture
   * instead of playing back at its own pace.
   */
  private buildingHeightScale(pitch: number): number {
    if (pitch < BUILDING_FLAT_PITCH) return 0
    if (pitch > BUILDING_FULL_PITCH) return 1
    // Quantised, because each distinct value costs a re-evaluation of the
    // height across every feature in every loaded tile. Five steps up the ramp
    // is as smooth as the eye needs and a third of the work of a continuous
    // one.
    return Math.round((pitch / BUILDING_FULL_PITCH) / BUILDING_SCALE_STEP) * BUILDING_SCALE_STEP
  }

  /**
   * Coalesce height updates to at most one per frame.
   *
   * `pitch` can fire more than once between paints, and each rescale is only
   * paid for at the next render — so firing straight from the handler queues
   * work that is thrown away. Latching to a frame is what the game gets for
   * free by routing the value through React state, which batches it.
   */
  private scheduleBuildingHeights() {
    if (this.heightFrame !== undefined) return
    this.heightFrame = requestAnimationFrame(() => {
      this.heightFrame = undefined
      this.updateBuildingHeights()
    })
  }

  /**
   * Re-scale the building heights for the current pitch.
   *
   * The quantised scale is its own throttle: across the whole ramp there are
   * only six distinct values, so the expensive part — re-setting a data-driven
   * paint property, which re-evaluates it across every feature in every loaded
   * tile — runs at most six times however slowly the map is tilted. That check
   * comes first because it rejects nearly every call.
   *
   * An earlier revision also throttled on how far the pitch had moved, which
   * could only ever delay a step the scale had already earned — it left the
   * buildings a notch too tall at the bottom of the ramp.
   */
  private updateBuildingHeights() {
    const k = this.buildingHeightScale(this.mapInstance.getPitch())
    if (k === this.lastHeightScale) return

    const id = layerGroups.building3d
    if (!this.mapInstance.getLayer(id)) return
    // 3D buildings switched off pins the height flat; leave it alone. Checked
    // without recording the scale, so the ramp resumes when they come back.
    if (!useMapStore().settings.objects3d) return

    this.lastHeightScale = k
    // Base scales with height, or the two come apart. A tall building is not
    // one box: it is a stack of parts, and the upper ones sit on a non-zero
    // `render_min_height`. Scaling only the height leaves those parts floating
    // at their original base while the rest sink, and once the scaled height
    // drops below the base the extrusion turns inside out — the offset shells
    // and torn roofs over places like Brookfield Place.
    //
    // Flat is written as a plain `0` rather than a scaled expression: a
    // constant needs no per-feature evaluation at all, which makes the last
    // step of the ramp the cheapest one instead of the most expensive.
    const minzoom = (this.mapInstance.getLayer(id) as any).minzoom ?? BUILDING_MIN_ZOOM
    this.mapInstance.setPaintProperty(id, 'fill-extrusion-height', this.grow(BUILDING_HEIGHT, k, minzoom))
    this.mapInstance.setPaintProperty(id, 'fill-extrusion-base', this.grow(BUILDING_BASE, k, minzoom))
  }

  /**
   * A property scaled by the pitch ramp, then grown in just past the layer's
   * minzoom so buildings rise out of the ground instead of appearing at full
   * height the instant the layer switches on.
   *
   * The zoom half lives in the expression rather than in JS. Unlike pitch,
   * zoom IS available to expressions, so MapLibre interpolates it on the GPU —
   * genuinely smooth, and free of the per-step re-evaluation the pitch ramp
   * has to pay for. `["zoom"]` is legal only as the direct input of a
   * top-level `interpolate`, hence the ramp on the outside with the
   * data-driven value as its upper stop rather than a tidier multiply.
   */
  private grow(value: unknown, k: number, minzoom: number): unknown {
    // Flat is a plain `0`: a constant needs no per-feature evaluation at all.
    if (k === 0) return 0
    const scaled = k === 1 ? value : ['*', value, k]
    return ['interpolate', ['linear'], ['zoom'], minzoom, 0, minzoom + BUILDING_GROW_ZOOM, scaled]
  }

  private defaultFov?: number
  /** Last scale actually applied; a pitch that does not change it costs nothing. */
  private lastHeightScale?: number
  /** Pending coalesced height update, cancelled on destroy. */
  private heightFrame?: number

  private reloadStyle() {
    this.mapInstance.setStyle(this.buildCurrentStyle(), { diff: false })
  }

  private buildCurrentStyle() {
    if (!this.tileServerUrl) {
      return { version: 8 as const, sources: {}, layers: [] }
    }
    const theme = this.options.theme === 'dark' ? 'dark' : 'light'
    const styleOpts = {
      tileServerUrl: this.tileServerUrl,
      theme: theme as 'light' | 'dark',
      tileKey: this.tileKey,
      mapStyle: this.options.mapStyle,
      poiStyle: this.poiStyle(),
      categoryColors: this.categoryColors(theme),
    }

    switch (this.currentBasemap) {
      case 'satellite':
        return buildSatelliteStyle({ ...styleOpts, hybrid: false })
      case 'hybrid':
        return buildSatelliteStyle({ ...styleOpts, hybrid: true })
      default:
        return buildMapStyle(styleOpts)
    }
  }

  setMapLanguage(locale: string): boolean {
    // TODO: Implement
    return false // MapLibre doesn't require reinitialization
  }

  removeSource(sourceId: string) {
    if (this.mapInstance.getSource(sourceId)) {
      this.mapInstance.removeSource(sourceId)
    }
  }

  addSource(sourceId: string, source: any) {
    try {
      // Remove existing source if it exists to prevent conflicts
      if (this.mapInstance.getSource(sourceId)) {
        this.mapInstance.removeSource(sourceId)
      }
      this.mapInstance.addSource(sourceId, source)
      console.log(`Added source: ${sourceId}`)
    } catch (error) {
      console.error(`Failed to add source ${sourceId}:`, error)
      throw error
    }
  }

  addLayer(layer: Layer, overwrite: boolean = false) {
    const { configuration }: any = mapboxLayerToMaplibreLayer(
      applyThemedStreetViewStyling(layer),
    )

    if (typeof configuration.source === 'object') {
      const { id: sourceId, ...sourceOptions } = configuration.source
      delete sourceOptions.generateId
      const existingSource = this.mapInstance.getSource(sourceId)

      if (existingSource) {
        if (overwrite) {
          this.mapInstance.removeSource(sourceId)
          this.mapInstance.addSource(sourceId, sourceOptions as any)
        }
      } else {
        this.mapInstance.addSource(sourceId, sourceOptions as any)
      }
      configuration.source = sourceId
    }

    if (typeof configuration.source === 'string') {
      const sourceExists = this.mapInstance.getSource(configuration.source)
      if (!sourceExists) {
        return
      }
    }

    const existingLayer = this.mapInstance.getLayer(configuration.id)
    if (existingLayer && overwrite) {
      this.mapInstance.removeLayer(configuration.id)
    }
    if (!existingLayer || overwrite) {
      try {
        this.mapInstance.addLayer({
          ...(configuration as any),
          layout: {
            ...configuration.layout,
            visibility: layer.visible ? 'visible' : 'none',
          },
        })
        if (layer.type === LayerType.STREET_VIEW) {
          this.streetViewLayerIds.add(configuration.id)
        }
      } catch (error) {
        console.error(`Failed to add layer '${configuration.id}':`, error)
      }
    }
  }

  // TODO: Use maplibre Layer['configuration']['id']
  removeLayer(layerId: string) {
    if (this.mapInstance.getLayer(layerId)) {
      this.mapInstance.removeLayer(layerId)
    }
  }

  // TODO: Use maplibre Layer['configuration']['id']
  toggleLayerVisibility(layerId: string, visible: boolean) {
    // Check if layer exists before trying to toggle visibility
    if (!this.mapInstance.getLayer(layerId)) {
      console.warn(
        `Cannot toggle visibility: layer '${layerId}' does not exist in map`,
      )
      return
    }

    this.mapInstance.setLayoutProperty(
      layerId,
      'visibility',
      visible ? 'visible' : 'none',
    )
  }

  zoomIn() {
    this.mapInstance.zoomIn()
  }

  zoomOut() {
    this.mapInstance.zoomOut()
  }

  resetNorth() {
    this.mapInstance.easeTo({
      bearing: 0,
      pitch: 0,
    })
  }

  getBounds() {
    if (!this.mapInstance) return null

    const bounds = this.mapInstance.getBounds()
    if (!bounds) return null

    return {
      north: bounds.getNorth(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      west: bounds.getWest(),
    }
  }

  locate() {
    this.geolocateControl.trigger()
  }

  destroy() {
    try {
      if (this.heightFrame !== undefined) cancelAnimationFrame(this.heightFrame)
      this.poiHandlerCleanup?.()
      this.poiHandlerCleanup = null
      this.unwatchTheme?.()

      // Remove the map instance
      if (this.mapInstance) {
        // Check if the map's canvas still exists before removing
        // This prevents errors when the DOM has already been cleaned up
        const canvas = this.mapInstance.getCanvas()
        if (canvas && canvas.parentElement) {
          this.mapInstance.remove()
        }
      }
    } catch (error) {
      // Silently catch errors during cleanup to prevent console spam
      // The map instance may already be partially destroyed
      console.debug('Map cleanup error (non-critical):', error)
    }
  }

  addMarker(id: string, lngLat: LngLat) {
    this.removeMarker(id) // Remove existing marker if any
    const marker = new Marker({ color: '#2563eb' })
      .setLngLat(lngLat as LngLatLike)
      .addTo(this.mapInstance)
    this.markers.set(id, marker)
  }

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
  ) {
    super.addVueMarker(id, lngLat, component, props, zIndex, dragOptions)
    this.removeMarker(id)

    const element = createVueMarkerElement(component, props)
    const draggable = !!dragOptions

    const marker = new Marker({
      element,
      anchor: 'center',
      ...(draggable && { draggable: true }),
    })
      .setLngLat(lngLat as LngLatLike)
      .addTo(this.mapInstance)

    if (zIndex !== undefined) {
      const markerElement = marker.getElement()
      if (markerElement) {
        markerElement.style.zIndex = String(zIndex)
      }
    }

    if (draggable && dragOptions) {
      const el = marker.getElement()
      if (el) {
        el.style.cursor = 'move'
      }
      if (dragOptions.onDrag) {
        marker.on('drag', () => {
          const pos = marker.getLngLat()
          dragOptions.onDrag!({ lng: pos.lng, lat: pos.lat })
        })
      }
      marker.on('dragend', () => {
        const pos = marker.getLngLat()
        dragOptions.onDragEnd({ lng: pos.lng, lat: pos.lat })
      })
    }

    this.markers.set(id, marker)
  }

  // Note: Waypoint markers are handled by base MapStrategy class

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

  unsetTrips() {
    for (const groupId of this.layerGroups.keys()) {
      if (groupId.startsWith('trip-')) {
        this.layerGroups.get(groupId)?.destroy()
        this.layerGroups.delete(groupId)
      }
    }
  }

  setRouteProfile(profile: import('@/lib/route-profile-colors').RouteProfileType | null) {
    for (const [groupId, group] of this.layerGroups.entries()) {
      if (groupId.startsWith('trip-') && group instanceof TripGroup) {
        group.setRouteProfile(profile)
      }
    }
  }

  setSegmentRouteProfile(
    tripId: string,
    segmentIndex: number,
    profile: import('@/lib/route-profile-colors').RouteProfileType | null,
  ) {
    const group = this.layerGroups.get(`trip-${tripId}`)
    if (group instanceof TripGroup) {
      group.setSegmentRouteProfile(segmentIndex, profile)
    }
  }

  private fitMapToTrips(trips: TripsResponse, visibleTripIds: Set<string>) {
    const visibleTrips = trips.trips.filter(trip => visibleTripIds.has(trip.id))
    if (visibleTrips.length === 0) return

    const bounds = new LngLatBounds()

    visibleTrips.forEach(trip => {
      trip.segments.forEach(segment => {
        if (segment.geometry) {
          segment.geometry.forEach(coord => {
            bounds.extend([coord.lng, coord.lat])
          })
        }
      })
    })

    // Extend by the request waypoints too — route geometry is snapped to
    // the road graph and may diverge from the user-specified waypoint
    // (e.g. a POI pinned slightly off the nearest road). Including the
    // waypoints guarantees every pin stays in view after the fit.
    trips.request?.waypoints?.forEach(wp => {
      const c = wp?.coordinate
      if (c && typeof c.lat === 'number' && typeof c.lng === 'number') {
        bounds.extend([c.lng, c.lat])
      }
    })

    if (bounds.isEmpty()) return

    const appStore = useAppStore()
    const padding = calculateFitPadding(
      appStore.visibleMapArea,
      this.container.clientWidth,
      this.container.clientHeight,
    )

    this.mapInstance.fitBounds(bounds, {
      padding,
      duration: 1000,
      // Building-level cap so a very short route doesn't zoom past street level.
      maxZoom: 19,
    })
  }

  /**
   * POI interaction.
   *
   * Both hover and click handlers are registered once and persist
   * across setStyle() calls. MapLibre's per-layer delegates (mouseenter,
   * mouseleave, click) internally use mousemove + queryRenderedFeatures
   * and call getLayer() on each event to filter to existing layers.
   * This means they automatically adapt when the style changes —
   * old layer IDs return nothing from getLayer() and are skipped,
   * new layer IDs are picked up as soon as they exist.
   *
   * We register delegates for ALL known POI layer IDs across all
   * styles. Only the ones present in the current style will fire.
   */
  private setupPoiHandlers() {
    if (this.poiHandlerCleanup) return
    if (!this.tileServerUrl) return

    // The minimal variant omits some of these; getLayer() returns nothing for
    // the absent ones and the delegate simply never fires.
    const allPoiLayerIds = layerGroups.poi

    const canvas = this.mapInstance.getCanvas()
    let hoverCount = 0

    const onEnter = () => {
      if (hoverCount++ === 0) canvas.style.cursor = 'pointer'
    }
    const onLeave = () => {
      hoverCount = Math.max(0, hoverCount - 1)
      if (hoverCount === 0) canvas.style.cursor = ''
    }

    const handleClick = (layerEvent: any) => {
      if (useMapToolsStore().activeTool === 'measure') return

      const feature = layerEvent.features?.[0]
      if (!feature?.id) return

      const { osmId, poiType } = parsePlanetilerOsmId(feature.id)
      if (poiType === 'unknown') return

      // Cancel the debounced generic click so we don't double-fire
      if (this.clickDebounceTimer) {
        clearTimeout(this.clickDebounceTimer)
        this.clickDebounceTimer = null
      }

      const poiName = feature.properties?.name
      mapEventBus.emit('click', {
        lngLat: layerEvent.lngLat,
        point: layerEvent.point,
        poi: {
          osmId,
          poiType,
          name: typeof poiName === 'string' ? poiName : undefined,
        },
      })
    }

    for (const id of allPoiLayerIds) {
      this.mapInstance.on('mouseenter', id, onEnter)
      this.mapInstance.on('mouseleave', id, onLeave)
      this.mapInstance.on('click', id, handleClick)
    }

    this.poiHandlerCleanup = () => {
      for (const id of allPoiLayerIds) {
        this.mapInstance.off('mouseenter', id, onEnter)
        this.mapInstance.off('mouseleave', id, onLeave)
        this.mapInstance.off('click', id, handleClick)
      }
      canvas.style.cursor = ''
    }
  }

  private updateStreetViewColors() {
    for (const id of this.streetViewLayerIds) {
      const layer = this.mapInstance.getLayer(id) as any
      if (!layer) continue
      const type = (layer as any).type
      if (type === 'circle') {
        const paint = buildStreetViewPaint({ type: 'circle' })
        this.mapInstance.setPaintProperty(
          id,
          'circle-color',
          paint['circle-color'],
        )
        this.mapInstance.setPaintProperty(
          id,
          'circle-stroke-color',
          paint['circle-stroke-color'],
        )
        this.mapInstance.setPaintProperty(
          id,
          'circle-opacity',
          paint['circle-opacity'],
        )
        this.mapInstance.setPaintProperty(
          id,
          'circle-stroke-opacity',
          paint['circle-stroke-opacity'],
        )
      }
      if (type === 'line') {
        const paint = buildStreetViewPaint({ type: 'line' })
        this.mapInstance.setPaintProperty(id, 'line-color', paint['line-color'])
        this.mapInstance.setPaintProperty(
          id,
          'line-opacity',
          paint['line-opacity'],
        )
      }
    }
  }

  // Note: Instruction point markers are now handled by base MapStrategy class
}
