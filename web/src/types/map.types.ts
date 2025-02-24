import { LngLatLike, Map as MapboxMap, LngLat as MapboxLngLat } from 'mapbox-gl'
import { Map as MaplibreMap } from 'maplibre-gl'
import { Icon } from '@/types/app.types'
import { Image, PointOfView } from 'mapillary-js'

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

export type MapOptions = {
  projection: string
  theme: MapTheme
  basemap: Basemap
  camera?: MapCamera
}

export type MapCamera = {
  center: LngLatLike // TODO: Use custom LngLatLike
  zoom: number
  bearing: number
  pitch: number
}

export type MapInstance = MapboxMap | MaplibreMap

export type LngLat = MapboxLngLat

export type Waypoint = {
  lngLat: LngLat | null
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
}

export type Source = {
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
  source: string | Source
  slot?: string
  // Allow any additional properties for layer-specific configuration
  [key: string]: any
}

export type MaplibreLayerConfiguration = {
  id: string
  type: MaplibreLayerType
  source: string | Source
  // Allow any additional properties for layer-specific configuration
  [key: string]: any
}

export enum LayerType {
  CUSTOM = 'custom',
  STREET_VIEW = 'street-view',
}

// TODO: Make MapboxLayer extend Layer
export type Layer = {
  name: string
  icon?: Icon
  type: LayerType
  enabled: boolean
  visible: boolean
  engine: MapEngine[]
  configuration: MapboxLayerConfiguration
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

export type Place = {
  id: number
  type: 'node' | 'way' | 'relation'
  tags: Record<string, string | undefined>
  lat?: number
  lon?: number
  version: number
  user: string
  center?: {
    lat: number
    lon: number
  }
  geometry?: Array<{
    lat: number
    lon: number
  }>
  bounds?: {
    minlat: number
    minlon: number
    maxlat: number
    maxlon: number
  }
}

export const MarkerIds = {
  SELECTED_POI: 'selected-poi',
} as const

export type MarkerId = (typeof MarkerIds)[keyof typeof MarkerIds]
