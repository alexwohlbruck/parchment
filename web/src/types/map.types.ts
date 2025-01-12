import { Map as MapboxMap } from 'mapbox-gl'
import { Map as MaplibreMap } from 'maplibre-gl'
import { Icon } from '@/types/app.types'

export type Basemap = 'standard' | 'satellite' | 'hybrid'
export type MapTheme = 'light' | 'dark'
export type MapEngine = 'mapbox' | 'maplibre'

export type MapOptions = {
  center: [number, number]
  zoom: number
  bearing: number
  pitch: number
  projection: string
  theme: 'light' | 'dark'
  basemap: Basemap
}

export type MapInstance = MapboxMap | MaplibreMap

export type LngLat = {
  lng: number
  lat: number
}

export type MapEvents = {
  click: {
    lngLat: LngLat
    point: { x: number; y: number }
  }
  load: MapInstance
  'style.load': MapInstance
  contextmenu: {
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
}

// TODO: Rename to MapboxLayerType
export enum LayerType {
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
  type: LayerType
  source: string | Source
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

// TODO: Make MapboxLayer extend Layer
export type Layer = {
  name: string
  icon: Icon
  enabled: boolean
  visible: boolean
  engine: 'mapbox'
  configuration: MapboxLayerConfiguration
}

export type MaplibreLayer = Layer & {
  configuration: MaplibreLayerConfiguration
}
