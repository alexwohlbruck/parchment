export type Basemap = 'standard' | 'satellite' | 'hybrid'
export type MapLayer = 'cycling' | 'transit' | 'traffic' | 'terrain'
export type MapLibrary = 'mapbox' | 'maplibre'
export type MapTheme = 'light' | 'dark'

export type MapOptions = {
  center: [number, number]
  zoom: number
  bearing: number
  pitch: number
  projection: string
  theme: 'light' | 'dark'
  basemap: Basemap
  layers: MapLayer[]
}

export type MapEvents = {
  'map:click': {
    coordinates: [number, number]
    point: { x: number; y: number }
  }
}
