import { LngLatLike, Map as MapboxMap, LngLat as MapboxLngLat } from 'mapbox-gl'
import { Map as MaplibreMap } from 'maplibre-gl'
import { Icon } from '@/types/app.types'
import { Image, PointOfView } from 'mapillary-js'
import { Place } from '@/types/place.types'

// TODO: Use types from official libs
// import { LayerSpecification, VectorSourceSpecification } from 'mapbox-gl'

export type Basemap = 'standard' | 'satellite' | 'hybrid'
export type MapStyleId = 'osm-liberty' | 'osm-openmaptiles'

export enum MapEngine {
  MAPBOX = 'mapbox',
  MAPLIBRE = 'maplibre',
}

export enum MapProjection {
  MERCATOR = 'mercator',
  GLOBE = 'globe',
  EQUIRECTANGULAR = 'equirectangular',
  NATURAL_EARTH = 'naturalEarth',
  WINKEL_TRIPEL = 'winkelTripel',
  ALBERS = 'albers',
  LAMBERT_CONFORMAL_CONIC = 'lambertConformalConic',
}

export enum MapTheme {
  LIGHT = 'light',
  DARK = 'dark',
}

export enum MapColorTheme {
  DEFAULT = 'default',
  FADED = 'faded',
  MONOCHROME = 'monochrome',
}

export enum LocateFlySpeed {
  INSTANT = 'instant',
  FAST = 'fast',
  NORMAL = 'normal',
  SLOW = 'slow',
}

export enum StartupLocation {
  LOCATE_ME = 'locateMe',
  LAST_VISITED = 'lastVisited',
  URL_PARAMS = 'urlParams',
}

export enum GridSnapMode {
  // Don't snap to city grids at all.
  OFF = 'off',
  // Snap only to the grid's upright (nearest-to-north) orientation.
  NORTH_UP = 'north-up',
  // Snap to any of the grid's four 90°-rotated orientations.
  ALL = 'all',
}

export enum FloorNumbering {
  ZERO_BASED = 'zero-based',
  ONE_BASED = 'one-based',
}

export interface MapSettings {
  theme: MapTheme
  engine: MapEngine
  basemap: Basemap
  mapStyle: MapStyleId
  camera?: MapCamera
  projection: MapProjection
  terrain3d: boolean
  objects3d: boolean
  poiLabels: boolean
  roadLabels: boolean
  transitLabels: boolean
  placeLabels: boolean
  hdRoads: boolean
  /**
   * When true, snaps the map upright when a rotation ends close to north. This
   * is our own reimplementation — the engine's native `bearingSnap` is disabled
   * so the behavior can be toggled live (see map.service `snapRotation`).
   */
  northUpSnap: boolean
  /**
   * Snap map rotation to a known city street grid when near one: off, the
   * grid's upright orientation only, or any of its four 90° rotations.
   */
  gridSnapMode: GridSnapMode
  locateFlySpeed: LocateFlySpeed
  startupLocation: StartupLocation
}

export type MapCamera = {
  center: LngLatLike // TODO: Use standard LngLat
  zoom: number
  bearing: number
  pitch: number
  padding?: {
    top?: number
    bottom?: number
    left?: number
    right?: number
  } // Padding around the viewport edges when considering visible content
  duration?: number // Animation duration in ms (passed through to flyTo)
}

export type MapInstance = MapboxMap | MaplibreMap

export type LngLat = {
  lng: number
  lat: number
}

export type MapBounds = {
  north: number
  south: number
  east: number
  west: number
}

export type WaypointTimeMode = 'departAfter' | 'arriveBy'

export type WaypointTimeConstraint = {
  mode: WaypointTimeMode
  time: string // ISO 8601
  dwellTime?: number // minutes to spend at this stop
}

export type Waypoint = {
  lngLat: LngLat | null
  place?: Partial<Place> | null
  /** Per-waypoint time constraint (depart after / arrive by + optional dwell). */
  timeConstraint?: WaypointTimeConstraint | null
}

export type MapillaryImage = Image // TODO: Use custom type

export type MapEvents = {
  click: {
    lngLat: LngLat
    point: { x: number; y: number }
    poi?: {
      osmId: string
      poiType: 'node' | 'way' | 'relation'
      name?: string
    }
  }
  // TODO: Fold this into 'click' event
  'click:mapillary-image': {
    lngLat: LngLat
    point: { x: number; y: number }
    image?: MapillaryImage
  }
  load: MapInstance
  moveend: MapCamera
  move: MapCamera
  // Fired only when the user finishes a manual rotation gesture (not for
  // programmatic camera moves). Drives the north-up and city-grid snap.
  rotateend: MapCamera
  'style.load': MapInstance
  contextmenu: {
    lngLat: LngLat
    point: { x: number; y: number }
  }
  // TODO: Fold this into 'click' event
  'click:friend-marker': {
    friendHandle: string
  }
  'click:tracker-marker': {
    trackerId: string
  }
  // Click on transit route line(s) and/or stop point(s). Emitted by the
  // transit line interaction wiring with the deduped candidates under the
  // click; the popover component navigates (single candidate) or
  // disambiguates (several — stops listed above routes).
  'click:transit-line': {
    lngLat: LngLat
    /** Viewport (client) px of the click — anchors the picker popover. */
    point: { x: number; y: number }
    candidates: import('@/lib/transit-route-candidates').TransitRouteCandidate[]
    stops: import('@/lib/transit-stop-candidates').TransitStopCandidate[]
  }
  // Click on a rail station DOM marker (TransitStationMarker). Station
  // complexes carry no GTFS ids, so the label point + name key the
  // /transit/station destination.
  'click:transit-station': {
    name: string
    lngLat: LngLat
  }
}

export enum SourceType {
  VECTOR = 'vector',
  RASTER = 'raster',
  RASTER_DEM = 'raster-dem',
  GEOJSON = 'geojson',
  IMAGE = 'image',
  VIDEO = 'video',
}

export type TileSource = {
  id: string
  type: SourceType
  url?: string
  tiles?: string[]
  tileSize?: number
  attribution?: string
  maxzoom?: number
  minzoom?: number
}

// TODO: Rename to MapboxLayerType
export enum MapboxLayerType {
  FILL = 'fill',
  LINE = 'line',
  SYMBOL = 'symbol',
  CIRCLE = 'circle',
  HEATMAP = 'heatmap',
  FILL_EXTRUSION = 'fill-extrusion',
  RASTER = 'raster',
  HILLSHADE = 'hillshade',
  BACKGROUND = 'background',
  SKY = 'sky',
}

export enum MaplibreLayerType {
  SYMBOL = 'symbol',
  RASTER = 'raster',
  FILL = 'fill',
  LINE = 'line',
  CIRCLE = 'circle',
  HEATMAP = 'heatmap',
  FILL_EXTRUSION = 'fill-extrusion',
  HILLSHADE = 'hillshade',
  BACKGROUND = 'background',
}

export type MapboxLayerConfiguration = {
  id: string
  type: MapboxLayerType
  source: string | TileSource
  slot?: string
  // Allow any additional properties for layer-specific configuration
  [key: string]: any
}

export type MaplibreLayerConfiguration = {
  id: string
  type: MaplibreLayerType
  source: string | TileSource
  // Allow any additional properties for layer-specific configuration
  [key: string]: any
}

export enum LayerType {
  CUSTOM = 'custom',
  STREET_VIEW = 'street-view',
  TRANSIT = 'transit',
  FRIENDS = 'friends',
  TRACKERS = 'trackers',
}

/**
 * Origin describes where a layer/group's canonical definition lives.
 * - 'default': projected from a server-side template (no DB row per user)
 * - 'custom':  user-created or cloned-from-default DB row, fully user-owned
 * - 'core':    hardcoded client-side layer (search results, place polygons, etc.)
 */
export type LayerOrigin = 'default' | 'custom' | 'core'

export interface Layer {
  id: string
  name: string
  type: LayerType
  engine: MapEngine[]
  showInLayerSelector: boolean
  visible: boolean
  fadeBasemap?: boolean
  icon?: string | null
  order: number
  groupId: string | null
  configuration: {
    id: string
    type: MapboxLayerType
    source:
      | string
      | {
          id: string
          type: SourceType
          [key: string]: any
        }
    slot?: string
    [key: string]: any
  }
  isSubLayer?: boolean
  enabled?: boolean
  integrationId?: string | null
  // Synthesized on the client when composing default templates + user state.
  // Never set for core layers or fresh custom layers.
  origin?: LayerOrigin
  // Set on a DB row when it was created by cloning a default template.
  clonedFromTemplateId?: string | null
  userId?: string
  createdAt?: string
  updatedAt?: string
}

export interface LayerGroup {
  id: string
  name: string
  showInLayerSelector: boolean
  visible: boolean
  fadeBasemap?: boolean
  icon?: string
  order: number
  parentGroupId?: string | null
  integrationId?: string | null
  origin?: LayerOrigin
  clonedFromTemplateId?: string | null
  userId: string
  createdAt: string
  updatedAt: string
}

// Simplified type for groups with their layers
export interface LayerGroupWithLayers extends LayerGroup {
  layers: Layer[]
}

export enum StreetViewType {
  MAPILLARY = 'mapillary',
  STREET_VIEW = 'street-view',
}

export type StreetViewImage = {
  type: StreetViewType
  id: string
}

export type PegmanLayerType = {
  POSITION: 'pegman-position'
  FOV: 'pegman-fov'
}

export const PEGMAN_LAYERS: PegmanLayerType = {
  POSITION: 'pegman-position',
  FOV: 'pegman-fov',
} as const

export type Pegman = {
  pov: {
    bearing: number
  }
  position: LngLat
  fov: number
  visible?: boolean
}

export const MarkerIds = {
  SELECTED_POI: 'selected-poi',
} as const

export type MarkerId = (typeof MarkerIds)[keyof typeof MarkerIds]

// Map control visibility settings
export enum ControlVisibility {
  ALWAYS = 'always',
  NEVER = 'never',
  WHILE_ROTATING = 'while-rotating', // for compass
  WHILE_ZOOMING = 'while-zooming', // for scale
  WHILE_ACTIVE = 'while-active', // for street view (when toggled on)
}

export interface MapControlSettings {
  zoom: ControlVisibility.ALWAYS | ControlVisibility.NEVER
  compass:
    | ControlVisibility.ALWAYS
    | ControlVisibility.WHILE_ROTATING
    | ControlVisibility.NEVER
  scale:
    | ControlVisibility.ALWAYS
    | ControlVisibility.WHILE_ZOOMING
    | ControlVisibility.NEVER
  streetView:
    | ControlVisibility.ALWAYS
    | ControlVisibility.WHILE_ACTIVE
    | ControlVisibility.NEVER
  locate: ControlVisibility.ALWAYS | ControlVisibility.NEVER
  weather: ControlVisibility.ALWAYS | ControlVisibility.NEVER
  toolbox?: ControlVisibility.ALWAYS | ControlVisibility.NEVER
}

export enum UnitSystem {
  METRIC = 'metric',
  IMPERIAL = 'imperial',
}
