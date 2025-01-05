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

export type Layer = {
  name: string
  icon: Icon
  enabled: boolean
  source: {
    id: string
    type: string
    tiles?: string[]
    tileSize?: number
    attribution?: string
    maxzoom?: number
    url?: string
  }
  meta?: any
}
