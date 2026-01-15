import { LngLatLike, Map as MapboxMap, LngLat as MapboxLngLat } from 'mapbox-gl'
import { Map as MaplibreMap } from 'maplibre-gl'
import { Icon } from '@/types/app.types'
import { Image, PointOfView } from 'mapillary-js'
import { Place } from '@/types/place.types'

// TODO: Use types from official libs
// import { LayerSpecification, VectorSourceSpecification } from 'mapbox-gl'

export type Basemap = 'standard' | 'satellite' | 'hybrid'

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

export interface MapSettings {
  theme: MapTheme
  engine: MapEngine
  basemap: Basemap
  camera?: MapCamera
  projection: MapProjection
  terrain3d: boolean
  objects3d: boolean
  poiLabels: boolean
  roadLabels: boolean
  transitLabels: boolean
  placeLabels: boolean
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

// TODO: Use optional fields
export type Waypoint = {
  lngLat: LngLat | null
  place?: Place | null
}

export type MapillaryImage = Image // TODO: Use custom type

export type MapEvents = {
  click: {
    lngLat: LngLat
    point: { x: number; y: number }
  }
  'click:mapillary-image': {
    lngLat: LngLat
    point: { x: number; y: number }
    image?: MapillaryImage
  }
  load: MapInstance
  moveend: MapCamera
  move: MapCamera
  'style.load': MapInstance
  contextmenu: {
    lngLat: LngLat
    point: { x: number; y: number }
  }
  'click:poi': {
    osmId: string
    poiType: 'node' | 'way' | 'relation'
    lngLat: LngLat
    point: { x: number; y: number }
  }
  'click:friend-marker': {
    friendHandle: string
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
}

export interface Layer {
  id: string
  name: string
  type: LayerType
  engine: MapEngine[]
  showInLayerSelector: boolean
  visible: boolean
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
  userId?: string
  createdAt?: string
  updatedAt?: string
}

export interface LayerGroup {
  id: string
  name: string
  showInLayerSelector: boolean
  visible: boolean
  icon?: string
  order: number
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
  compass: ControlVisibility.ALWAYS | ControlVisibility.WHILE_ROTATING | ControlVisibility.NEVER
  scale: ControlVisibility.ALWAYS | ControlVisibility.WHILE_ZOOMING | ControlVisibility.NEVER
  streetView: ControlVisibility.ALWAYS | ControlVisibility.WHILE_ACTIVE | ControlVisibility.NEVER
  locate: ControlVisibility.ALWAYS | ControlVisibility.NEVER
}
