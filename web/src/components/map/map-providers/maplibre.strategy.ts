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
  setWorkerUrl,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// MapLibre 6 is ESM-only and loads its worker from a URL it computes at
// runtime, relative to its own `import.meta.url`. A bundler cannot see that as
// a worker reference, so the file is never emitted next to the bundle and the
// request comes back empty — the map then fails to start with "Loading Worker
// ... blocked because of a disallowed MIME type". Worse, when `import.meta.url`
// is not an http URL the library gives up and returns an empty string, which
// resolves against the page root and trips a file:// security error.
//
// `?url` makes Vite emit the worker as a real asset and hand back its final
// URL, in dev and in a production build alike, and `setWorkerUrl` is the
// library's supported way to say where it went.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'

setWorkerUrl(maplibreWorkerUrl)
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
  MAX_PITCH,
  BUILDING_HEIGHT_EXPRESSION,
  BUILDING_BASE_EXPRESSION,
  BUILDING_ROOF_EDGE_LAYER,
} from '@/lib/map-style'
import { isTransitPoi } from '@/lib/map-style/transit-poi.mjs'
import { registerPoiBadges, type BadgeHost } from '@/lib/map-style/poi-badge'
import { OBJECT_FLAT_LAYERS, TREE_OPACITY } from '@/lib/map-style/detail-layers'
import { loadGlb, type GlbModel } from '@/lib/map-objects/glb.mjs'
import {
  ObjectLayer,
  OBJECT_MODELS,
  OBJECT_PALETTE,
  OBJECT_SOLID,
  OBJECT_SPECS,
} from '@/lib/map-objects'
import {
  terrainSource,
  TERRAIN_SOURCE_ID,
  TERRAIN_EXAGGERATION,
} from '@/lib/map-style/terrain'
import {
  rgbToHex,
  adjustLightness,
} from '@/lib/utils'
import {
  createBuildingShade,
  liveBuildingShade,
  shadeLight,
  sunShadow,
  BUILDING_SHADE_LAYER_ID,
} from '@/lib/building-shade'
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

/** Degrees of pitch over which the plan-view roof outline fades out. */
const ROOF_EDGE_FADE_PITCH = 8

/** The one custom layer every 3D scene object is drawn by. */
const OBJECT_LAYER_ID = 'map-objects'

/**
 * The first label layer the 3D objects have to stay behind.
 *
 * Found rather than named, so a reordered style does not silently put trees
 * back over the labels. The flat forms of these same objects mark the point in
 * the stack where they belong — everything drawn after them is a label of some
 * kind — so the answer is the first symbol layer past the last of those.
 *
 * Returns undefined if the style has none, which puts the layer on top. That is
 * where it used to sit, and it is the right fallback: a satellite basemap has
 * no detail layers, and drawing the objects is better than not.
 */
function firstLabelLayer(map: MaplibreMap): string | undefined {
  const layers = map.getStyle()?.layers ?? []
  let after = -1
  layers.forEach((layer, i) => {
    if (OBJECT_FLAT_LAYERS.includes(layer.id)) after = i
  })
  if (after < 0) return undefined
  return layers.slice(after + 1).find(layer => layer.type === 'symbol')?.id
}


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
  /** The two switches gating the building lighting; see `applyBuildingShade`. */
  private buildingShade = true
  private map3dBuildings = true
  private map3dObjects = true
  /** Trees and the rest; see `applyMapObjects`. */
  private objectLayer: ObjectLayer | null = null
  private objectModels: Promise<Record<string, GlbModel>> | null = null

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
      maxPitch: MAX_PITCH,
      attributionControl: false,
      // Disable the engine's built-in north snap — we do north + grid snapping
      // ourselves in map.service (snapRotation) so both settings toggle live.
      bearingSnap: 0,
      // MapLibre 6 made rotation "orbital" by default: the bearing is computed
      // from the cursor's angle about the centre of the screen, so dragging
      // right reverses direction depending on whether you are above or below
      // the middle, like spinning a globe. v4 was linear — horizontal movement
      // mapped straight to bearing wherever the cursor was — which is what this
      // map has always felt like, and what Mapbox does.
      aroundCenter: false,
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

    // Added for `trigger()` alone — the app draws its own locate button, and
    // the one this control renders is hidden in `Map.vue`. It still goes
    // through `addControl` so `map.remove()` tears its geolocation watch down.
    this.geolocateControl = new GeolocateControl({
      positionOptions: {
        enableHighAccuracy: true,
      },
      trackUserLocation: true,
      showUserLocation: true,
      showAccuracyCircle: true,
    })

    // Answers for the POI badges, which the style names but the sprite cannot
    // carry — see `poi-badge.ts`. Set on the map rather than per style, since
    // the resolver survives a style swap and every flavor needs it.
    registerPoiBadges(this.mapInstance as unknown as BadgeHost)

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
    this.mapInstance.on('pitch', () => this.updateCameraProjection())
    // A quarter of a degree a minute: five is far finer than the eye needs and
    // costs one trig evaluation.
    this.sunTimer = setInterval(() => this.updateSunShadow(), 5 * 60 * 1000)
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
      this.updateCameraProjection()
      // A style swap drops the custom layer and restores the extrusion's own
      // opacity, so the shading has to be re-added rather than merely left be.
      this.applyBuildingShade()
      this.updateRoofEdge()
      // A style swap drops custom layers with it, and rebuilds the flat form's
      // visibility from the stylesheet.
      this.objectLayer = null
      void this.applyMapObjects()
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
      this.updateSunShadow()
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

  setMap3dBuildings(value: boolean) {
    const buildingLayerId = layerGroups.building3d
    if (!this.mapInstance.getLayer(buildingLayerId)) return

    if (value) {
      // Restore exactly what the style defines, zoom ramp included, rather
      // than a literal height that would skip the grow-in.
      this.mapInstance.setPaintProperty(
        buildingLayerId,
        'fill-extrusion-height',
        BUILDING_HEIGHT_EXPRESSION,
      )
      this.mapInstance.setPaintProperty(
        buildingLayerId,
        'fill-extrusion-base',
        BUILDING_BASE_EXPRESSION,
      )
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
    this.map3dBuildings = value
    this.applyBuildingShade()
  }

  /**
   * Trees as models rather than as the flat marks that stand in for them.
   *
   * The two forms come from the same vector source, so this is a swap rather
   * than a load: the circle layer is hidden and the object layer draws the same
   * features. Models are fetched once, on the first time the setting is turned
   * on, so a user who never enables it never pays for them.
   */
  override setMap3dObjects(value: boolean) {
    this.map3dObjects = value
    void this.applyMapObjects()
  }

  private async applyMapObjects() {
    const map = this.mapInstance
    // Muted rather than hidden: see `TREE_OPACITY`.
    const flat = () => {
      for (const id of OBJECT_FLAT_LAYERS) {
        const layer = map.getLayer(id)
        if (!layer) continue
        map.setPaintProperty(
          id,
          layer.type === 'line' ? 'line-opacity' : 'circle-opacity',
          this.map3dObjects ? 0 : TREE_OPACITY,
        )
      }
    }

    if (!this.map3dObjects) {
      if (this.objectLayer && map.getLayer(this.objectLayer.id)) {
        map.removeLayer(this.objectLayer.id)
      }
      this.objectLayer = null
      flat()
      return
    }

    this.objectModels ??= Promise.all(
      Object.entries(OBJECT_MODELS).map(async ([name, url]) => [name, await loadGlb(url)] as const),
    ).then(entries => Object.fromEntries(entries))

    let models: Record<string, GlbModel>
    try {
      models = await this.objectModels
    } catch (error) {
      // A model that will not load leaves the flat form drawing, which is a
      // complete map rather than a hole where the trees were.
      console.error('3D objects: could not load models', error)
      this.objectModels = null
      this.map3dObjects = false
      flat()
      return
    }

    // The setting may have been turned back off, or the style swapped, while
    // the models were in flight.
    if (!this.map3dObjects) return flat()

    const flavor = this.options.theme === 'dark' ? 'dark' : 'light'
    // Already drawing: a flavor change is a uniform, not a rebuild.
    if (map.getLayer(OBJECT_LAYER_ID) && this.objectLayer) {
      this.objectLayer.setFlavor(OBJECT_PALETTE[flavor])
      return flat()
    }

    this.objectLayer = new ObjectLayer(OBJECT_SPECS, models, OBJECT_PALETTE[flavor], {
      id: OBJECT_LAYER_ID,
      solid: OBJECT_SOLID,
    })
    // Above the buildings, below every label. Against the buildings the depth
    // buffer decides — both write depth, so a tree in front of a tower hides
    // part of it — but a symbol layer ignores depth entirely, so the only thing
    // keeping a tree from covering a place marker is drawing it first.
    map.addLayer(this.objectLayer as any, firstLabelLayer(map))
    flat()
  }

  override setBuildingShade(value: boolean) {
    this.buildingShade = value
    this.applyBuildingShade()
  }

  /**
   * Reconcile the lighting layer with the two switches that gate it.
   *
   * Kept apart from the setters because both of them feed it and each has to
   * leave the other's preference alone — turning 3D buildings off and back on
   * must not silently clear the shading, which is what happens if the two share
   * a single flag. Flat buildings get no shading: there is nothing to light, and
   * the layer walks the same buckets either way, so it would spend the whole
   * per-frame cost on zero-height geometry.
   *
   * The layer takes over drawing the buildings, so the style's own extrusion is
   * muted rather than removed: at opacity 0 MapLibre skips the draw but still
   * builds and keeps the tiles and buckets, which is exactly the geometry the
   * layer borrows. Dropping the layer restores the opacity and the built-in
   * draw resumes, with no other state to unwind.
   */
  private applyBuildingShade() {
    const buildingLayerId = layerGroups.building3d
    if (!this.mapInstance.getLayer(buildingLayerId)) return

    const active = this.buildingShade && this.map3dBuildings
    const present = !!this.mapInstance.getLayer(BUILDING_SHADE_LAYER_ID)
    if (active && !present) {
      const flavor = this.options.theme === 'dark' ? 'dark' : 'light'
      // Directional shading and cast shadows have to agree on where the sun is;
      // the layer reads its direction from the style light rather than from its
      // own options, so this has to be set before it draws.
      this.mapInstance.setLight(shadeLight())
      this.mapInstance.addLayer(
        createBuildingShade(
          buildingLayerId,
          flavor,
          this.mapInstance.getLayer(buildingLayerId)?.minzoom,
        ) as any,
        this.layerAfter(buildingLayerId),
      )
      this.shadowAlphaAtNoon = undefined
      this.updateSunShadow()
    } else if (!active && present) {
      this.mapInstance.removeLayer(BUILDING_SHADE_LAYER_ID)
    }
    this.mapInstance.setPaintProperty(
      buildingLayerId,
      'fill-extrusion-opacity',
      active ? 0 : 1,
    )
  }

  /**
   * Point the shadows where the real sun is, for wherever the map is looking.
   *
   * Direction and length both come from the sun's actual position, so a map of
   * Manhattan in the afternoon throws its shadows east and long, and the same
   * view at noon throws them short — and a city in the other hemisphere throws
   * them the other way entirely. `daylight` folds in the sunrise and sunset
   * ramp, taking the cast shadow to nothing overnight while the ambient
   * occlusion that separates one building from the next stays put.
   *
   * Recomputed on `moveend` rather than per frame: the sun moves a quarter of a
   * degree a minute, and the answer only depends on where the map is and what
   * time it is. The interval covers a map left open, which is the only way the
   * time can change without the camera moving.
   */
  private updateSunShadow() {
    const layer = this.mapInstance.getLayer(BUILDING_SHADE_LAYER_ID)
      ? (liveBuildingShade() as any)
      : null

    const { lng, lat } = this.mapInstance.getCenter()
    const sun = sunShadow(new Date(), lat, lng)

    if (!layer) return

    layer.shadowOffset = sun.offset
    layer._heightScale = sun.heightScale
    // Hold the tuned darkness as the daylight maximum rather than overwriting
    // it, so the settings panel and the flavor still have the final say.
    this.shadowAlphaAtNoon ??= layer.shadowAlpha as number
    layer.shadowAlpha = this.shadowAlphaAtNoon * sun.daylight

    this.mapInstance.setLight(shadeLight(sun.offset, sun.altitude))
    this.mapInstance.triggerRepaint()
  }

  private shadowAlphaAtNoon?: number
  private sunTimer?: ReturnType<typeof setInterval>

  /** The id of the layer drawn directly above `layerId`, if any. */
  private layerAfter(layerId: string): string | undefined {
    const ids = this.mapInstance.getStyle().layers.map((l: any) => l.id)
    return ids[ids.indexOf(layerId) + 1]
  }

  /**
   * The basemap's own transit POIs, hidden while the transit layer group draws
   * its stops over the top.
   *
   * Two sources of stops for the same station is one too many: the basemap's
   * come from OpenStreetMap and the overlay's from the GTFS feeds, they rarely
   * sit at exactly the same coordinate, and the pair collide into a smear of
   * near-duplicate labels. The overlay's are the better data when it is on —
   * they know the routes — so the basemap's stand down.
   *
   * Done with a filter rather than by hiding the layers, because they carry
   * every other POI too. The layer's own filter is kept so the extra clause can
   * be added and removed without having to rebuild it.
   */
  setBasemapTransitPoisVisible(visible: boolean) {
    for (const id of layerGroups.poi) {
      if (!this.mapInstance.getLayer(id)) continue
      if (!this.basePoiFilters.has(id)) {
        this.basePoiFilters.set(id, this.mapInstance.getFilter(id) ?? null)
      }
      const base = this.basePoiFilters.get(id) ?? null
      if (visible) {
        this.mapInstance.setFilter(id, base as any)
        continue
      }
      const notTransit = ['!', isTransitPoi()]
      this.mapInstance.setFilter(id, (base ? ['all', base, notTransit] : notTransit) as any)
    }
  }

  /** Each POI layer's filter as the style defined it; see above. */
  private basePoiFilters = new Map<string, unknown>()

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
    const current = this.mapInstance.getVerticalFieldOfView()
    if (this.defaultFov === undefined) this.defaultFov = current

    // Not `=== 0`: an eased pitch animation can settle a hair off zero, and
    // the view is still flat on at a thousandth of a degree.
    const topDown = Math.abs(this.mapInstance.getPitch()) < TOP_DOWN_EPSILON
    this.updateRoofEdge()
    const wanted = topDown ? ORTHO_FOV : this.defaultFov
    // `pitch` fires continuously through a gesture; setting the field of view
    // recomputes every matrix, so only touch it when the answer changes.
    if (Math.abs(current - wanted) < 0.001) return
    this.mapInstance.setVerticalFieldOfView(wanted)
  }

  /**
   * Fade the footprint outline in as the camera flattens.
   *
   * The shader's roofline edge lives on the top of each wall, which disappears
   * along with the walls in a plan view. The footprint is the same line seen
   * from above — but only while the camera is orthographic, since a tilted
   * camera separates the two and the outline slides off onto the ground. So it
   * is tied to pitch, arriving over the last few degrees before flat rather
   * than snapping on, and there is no `["pitch"]` expression to do it in the
   * style.
   */
  private updateRoofEdge() {
    if (!this.mapInstance.getLayer(BUILDING_ROOF_EDGE_LAYER)) return
    const pitch = Math.abs(this.mapInstance.getPitch())
    const opacity = 1 - Math.min(pitch / ROOF_EDGE_FADE_PITCH, 1)
    this.mapInstance.setPaintProperty(BUILDING_ROOF_EDGE_LAYER, 'line-opacity', opacity)
  }

  private defaultFov?: number

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
      useThemeStore().isDark,
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
      this.poiHandlerCleanup?.()
      this.poiHandlerCleanup = null
      this.unwatchTheme?.()
      if (this.sunTimer) clearInterval(this.sunTimer)

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
