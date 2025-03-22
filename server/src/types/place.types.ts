export interface PlaceNode {
  lat: number
  lon: number
}

export interface PlaceCenter {
  lat: number
  lon: number
}

export interface Place {
  id: number
  type: 'node' | 'way' | 'relation'
  tags?: Record<string, string>
  lat?: number
  lon?: number
  center?: PlaceCenter
  geometry?: PlaceNode[]
  version?: number
  user?: string
  placeType?: string
  image?: string | null
  brandLogo?: string | null
}
