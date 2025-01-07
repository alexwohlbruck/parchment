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

export type MapEvents = {
  'map:click': {
    coordinates: [number, number]
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

export type Layer = {
  id: string
  name: string
  icon: Icon
  enabled: boolean
  type: LayerType
  source: string | Source
  meta?: any
}
