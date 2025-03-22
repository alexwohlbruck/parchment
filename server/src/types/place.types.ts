export interface PlaceNode {
  lat: number
  lon: number
}

export interface PlaceCenter {
  lat: number
  lon: number
}

export interface PlaceBounds {
  minlat: number
  minlon: number
  maxlat: number
  maxlon: number
}

export interface Place {
  id: number
  type: 'node' | 'way' | 'relation'
  tags?: Record<string, string>
  lat?: number
  lon?: number
  center?: PlaceCenter
  geometry?: PlaceNode[]
  bounds?: PlaceBounds
  version?: number
  user?: string
  placeType?: string
  image?: string | null
  brandLogo?: string | null
}
