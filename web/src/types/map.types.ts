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
}

export enum SourceType {
  RASTER = 'raster',
  VECTOR = 'vector',
  RASTER_DEM = 'raster-dem',
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
  LINE = 'line',
  FILL = 'fill',
  SYMBOL = 'symbol',
  CIRCLE = 'circle',
  HEATMAP = 'heatmap',
  FILL_EXTRUSION = 'fill-extrusion',
  RASTER = 'raster',
  RASTER_PARTICLE = 'raster-particle',
  HILLSHADE = 'hillshade',
  MODEL = 'model',
  BACKGROUND = 'background',
  SKY = 'sky',
  SLOT = 'slot',
  CLIP = 'clip',
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
}

// Layer Group Types
export interface LayerGroup {
  id: string
  name: string
  icon?: Icon
  showInLayerSelector: boolean
  visible: boolean
  order: number
  layerIds: string[]
  createdAt?: string
  updatedAt?: string
}

// Unified item that can be either a group or a layer
export type LayerItem =
  | { type: 'group'; data: LayerGroup & { layers: Layer[] } }
  | { type: 'layer'; data: Layer }

// TODO: Make MapboxLayer extend Layer
export type Layer = {
  name: string
  icon?: Icon
  type: LayerType
  showInLayerSelector: boolean
  visible: boolean
  engine: MapEngine[]
  configuration: MapboxLayerConfiguration
  groupId?: string // Reference to layer group
  order?: number // Order within group or global order if ungrouped
}

export type MaplibreLayer = Layer & {
  configuration: MaplibreLayerConfiguration
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
