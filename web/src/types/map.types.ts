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

export type Source = {
  id: string
  type: string
  url?: string
  tiles?: string[]
  tileSize?: number
  attribution?: string
  maxzoom?: number
}

export type Layer = {
  id: string
  name: string
  icon: Icon
  enabled: boolean
  source: string | Source
  meta?: any
}
