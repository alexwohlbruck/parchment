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

export interface GooglePlaceDetails {
  place_id: string
  name: string
  formatted_address: string
  formatted_phone_number: string
  website: string
  types: string[]
  photos: {
    photo_reference: string
    height: number
    width: number
    html_attributions: string[]
  }[]
  rating: number
  user_ratings_total: number
  opening_hours?: {
    open_now?: boolean
    periods?: {
      open: { day: number; time: string }
      close: { day: number; time: string }
    }[]
    weekday_text?: string[]
  }
  // Editorial summary with place description
  editorial_summary?: {
    language?: string
    languageCode?: string
    overview?: string
    text?: string
  }
  // Location/geometry data
  geometry?: {
    location: {
      lat: number
      lng: number
    }
  }
  // New fields
  google_maps_uri: string
  price_level: string
  business_status: string
  dine_in: boolean
  takeout: boolean
  delivery: boolean
  curbside_pickup: boolean
  serves_breakfast: boolean
  serves_lunch: boolean
  serves_dinner: boolean
  serves_beer: boolean
  serves_vegetarian: boolean
  serves_cocktails: boolean
  serves_coffee: boolean
  outdoor_seating: boolean
  live_music: boolean
  good_for_children: boolean
  good_for_groups: boolean
  restroom: boolean
  utc_offset: number
}

export interface Place {
  id: string
  type: 'node' | 'way' | 'relation'
  tags?: Record<string, string>
  lat?: number
  lon?: number
  center?: PlaceCenter
  geometry?: PlaceNode[]
  bounds?: PlaceBounds
  version?: number
  user?: string
  timestamp?: string // ISO date string of when the OSM object was last updated
  placeType?: string
  image?: string | null
  brandLogo?: string | null
  // Extended data from external APIs
  name?: string
  rating?: number
  reviewCount?: number
  url?: string
  photos?: string[]
  hours?: {
    isOpenNow: boolean
    periods: Array<{
      day: number
      open: string
      close: string
    }>
  }
  categories?: string[]
  address?: string
  externalIds?: {
    googlePlaces?: string
  }
}
