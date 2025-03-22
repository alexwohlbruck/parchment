export type SourceId =
  | 'osm'
  | 'yelp'
  | 'opentable'
  | 'google'
  | 'tripadvisor'
  | 'foursquare'
  | string

export interface SourceReference {
  id: SourceId
  name: string
  url: string
  updated?: string // ISO date string
  updatedBy?: string
}

export interface AttributedValue<T> {
  value: T
  sourceId: SourceId
  confidence?: number // 0-1, for resolving conflicts
  timestamp?: string // ISO date string when this data was fetched
}

export interface Coordinates {
  lat: number
  lng: number
}

export interface PlaceGeometry {
  type: 'point' | 'polygon' | 'multipolygon'
  center: Coordinates
  plusCode?: string
  bounds?: {
    minLat: number
    minLng: number
    maxLat: number
    maxLng: number
  }
  nodes?: Coordinates[] // For polygons/ways
}

export interface PlacePhoto {
  url: string
  sourceId: SourceId
  width?: number
  height?: number
  alt?: string
  isPrimary?: boolean
  isCover?: boolean
  isLogo?: boolean
}

export interface Address {
  street1?: string
  street2?: string
  neighborhood?: string
  locality?: string // City/town
  region?: string // State/province
  postalCode?: string
  country?: string
  countryCode?: string // ISO country code
  formatted?: string // Full formatted address as a single string
}

export interface OpeningTime {
  day: number // 0-6, starting Sunday
  open: string // 24h format "08:00"
  close: string // 24h format "17:00"
}

export interface OpeningHours {
  regularHours: OpeningTime[]
  holidayHours?: Record<string, OpeningTime[]> // Key is ISO date
  isOpen24_7?: boolean
  rawText?: string // Original text format from source
}

export interface Amenity {
  key: string
  value: string | boolean | number
  displayName?: string
}

export interface ContactInfo {
  phone?: string
  formattedPhone?: string
  email?: string
  website?: string
  socials?: Record<string, string> // platform -> URL
}

export interface UnifiedPlace {
  id: string // A unique identifier
  externalIds: Record<SourceId, string> // Source -> external ID mapping

  name: AttributedValue<string>[]
  description?: AttributedValue<string>[]
  placeType: AttributedValue<string>[]

  geometry: AttributedValue<PlaceGeometry>[]
  photos: PlacePhoto[]

  address: AttributedValue<Address>[]
  contactInfo: {
    phone: AttributedValue<string>[]
    email: AttributedValue<string>[]
    website: AttributedValue<string>[]
    socials: Record<string, AttributedValue<string>[]>
  }

  openingHours: AttributedValue<OpeningHours>[]

  amenities: Record<string, AttributedValue<string | boolean | number>[]>
  ratings?: Record<
    SourceId,
    {
      overallRating: number
      reviewCount: number
      url?: string
    }
  >

  // All sources that contributed data
  sources: SourceReference[]

  // Metadata
  lastUpdated: string // ISO date string
  createdAt: string // ISO date string
}

// Helper for selecting the best value from multiple attributed values
export function selectBestValue<T>(values: AttributedValue<T>[]): T | null {
  if (!values || values.length === 0) return null
  if (values.length === 1) return values[0].value

  // Sort by confidence (if available) or newest timestamp
  return values.sort((a, b) => {
    if (a.confidence !== undefined && b.confidence !== undefined) {
      return b.confidence - a.confidence
    }
    if (a.timestamp && b.timestamp) {
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    }
    return 0
  })[0].value
}
