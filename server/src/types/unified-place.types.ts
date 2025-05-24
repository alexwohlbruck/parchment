import { SOURCE } from '../lib/constants'
import type { Bookmark } from './library.types'

export type SourceId = (typeof SOURCE)[keyof typeof SOURCE] | string

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
  timestamp?: string
  updatedBy?: string
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
  open: string // 24h format "HH:mm"
  close: string // 24h format "HH:mm"
}

export interface OpeningHours {
  regularHours: OpeningTime[] // Array of regular opening hours
  isOpen24_7: boolean // True if the place is always open
  isPermanentlyClosed: boolean // True if the place is permanently closed
  isTemporarilyClosed: boolean // True if the place is temporarily closed
  holidayHours?: Record<string, OpeningTime[]> // Key is ISO date
  rawText?: string // Original text format from source
  nextOpenDate?: string // ISO date string for when temporarily closed places will reopen
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

/**
 * A place object with attributed values for all fields
 * This consistently tracks the source of each piece of data
 */
export interface Place {
  id: string // A unique identifier
  externalIds: Record<SourceId, string> // Source -> external ID mapping

  // Basic attributes as AttributedValues - these will always have a value
  name: AttributedValue<string>
  description: AttributedValue<string> | null
  placeType: AttributedValue<string>

  // Geographical attributes
  geometry: AttributedValue<PlaceGeometry>
  photos: AttributedValue<PlacePhoto>[]

  // Address information
  address: AttributedValue<Address> | null

  // Contact information
  contactInfo: {
    phone: AttributedValue<string> | null
    email: AttributedValue<string> | null
    website: AttributedValue<string> | null
    socials: Record<string, AttributedValue<string>>
  }

  // Operating hours
  openingHours: AttributedValue<OpeningHours> | null

  // Features and ratings
  amenities: Record<string, AttributedValue<string | boolean | number>>
  ratings?: {
    rating: AttributedValue<number>
    reviewCount: AttributedValue<number>
  }

  // All sources that contributed data
  sources: SourceReference[]

  // Metadata
  lastUpdated: string // ISO date string
  createdAt: string // ISO date string

  // User-specific data
  bookmark?: Bookmark
  collectionIds?: string[]
}

/**
 * Creates an AttributedValue from a plain value
 * @param value The value to wrap
 * @param sourceId The source ID to attribute the value to
 * @param timestamp Optional timestamp
 * @returns An AttributedValue containing the value
 */
export function createAttributedValue<T>(
  value: T,
  sourceId: SourceId,
  timestamp?: string,
): AttributedValue<T> {
  return {
    value,
    sourceId,
    timestamp: timestamp || new Date().toISOString(),
  }
}

export function selectBestValue<T>(values: AttributedValue<T>[]): T | null {
  if (!values || values.length === 0) return null
  return values[0].value
}
