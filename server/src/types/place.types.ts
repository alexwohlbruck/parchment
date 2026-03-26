import { SOURCE } from '../lib/constants'
import { Bookmark } from './library.types'

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
  type: 'point' | 'linestring' | 'polygon' | 'multipolygon'
  center: Coordinates
  plusCode?: string
  bounds?: {
    minLat: number
    minLng: number
    maxLat: number
    maxLng: number
  }
  nodes?: Coordinates[] // For linestrings and simple polygon exterior rings
  rings?: Coordinates[][] // For polygons with holes: array of rings (first is exterior, subsequent are holes)
  polygons?: Coordinates[][][] // For multipolygons: array of polygons, each polygon is array of rings (first is exterior, subsequent are holes)
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

export interface TransitDeparture {
  arrivalTime?: string // ISO time string
  departureTime?: string // ISO time string
  scheduledArrivalTime?: string
  scheduledDepartureTime?: string
  delay?: number // in seconds
  realTime?: boolean
  headsign?: string
  direction?: string
  stopSequence?: number
  trip: {
    id: string
    shortName?: string
    headsign?: string
    directionId?: number
    blockId?: string
    routeId: string
  }
  route: {
    id: string
    shortName?: string
    longName?: string
    color?: string
    textColor?: string
    type?: number // GTFS route type
    agencyId?: string
  }
  agency?: {
    id: string
    name?: string
    url?: string
    timezone?: string
    phone?: string
  }
}

export interface TransitStopInfo {
  onestopId: string
  onestopIds?: string[] // For transfer hubs with multiple platforms
  name?: string
  code?: string
  description?: string
  timezone?: string
  wheelchairBoarding?: number
  departures?: TransitDeparture[]
  routes?: Array<{
    id: string
    shortName?: string
    longName?: string
    color?: string
    textColor?: string
    type?: number
  }>
}

export interface PlaceRelation {
  id: string // OSM ID (e.g., "relation/123456")
  type: 'relation' | 'way' | 'node'
  name?: string
  placeType?: string
  role?: string // Role in the relation (e.g., "platform", "stop_area", "building")
  relationshipType: 'parent' | 'child' | 'member' // How this relates to the main place
  tags?: Record<string, string> // Relevant OSM tags
}

export enum WidgetType {
  TRANSIT = 'transit',
  RELATED_PLACES = 'related_places',
}

export type RelatedPlacesStrategy = 'children' | 'parent' | 'admin'

export interface RelatedParent {
  id: string // OSM ID like "relation/123"
  name: string
  placeType: string // e.g., "Shopping Mall", "City"
  icon?: PlaceIcon // Resolved icon for display
  tags?: Record<string, string>
}

export interface RelatedPlacesData {
  strategy: RelatedPlacesStrategy
  children: Place[] // POIs inside this area (children strategy)
  parents: RelatedParent[] // Containing areas (parent/admin strategy)
  centerLat: number // Parent place center (for client-side distance display)
  centerLng: number
}

export interface WidgetDescriptor {
  type: WidgetType
  title: string
  estimatedHeight: number // px, for skeleton placeholder on client
  params: Record<string, string | number | boolean>
}

export interface WidgetResponse<T = unknown> {
  type: WidgetType
  data: AttributedValue<T>
  sources: SourceReference[]
}

export interface NearbyCategory {
  presetId: string // OSM preset ID, e.g. "amenity/cafe"
  name: string // Display label, e.g. "Cafes"
  icon?: string // Resolved icon name
  iconPack?: 'lucide' | 'maki'
  iconCategory?: PlaceCategory // For color theming
}

export type PlaceCategory =
  | 'food_and_drink'
  | 'education'
  | 'medical'
  | 'sport_and_leisure'
  | 'store'
  | 'arts_and_entertainment'
  | 'commercial_services'
  | 'park'
  | 'default'

export interface PlaceIcon {
  category: PlaceCategory
  icon: string // e.g. 'restaurant', 'hospital', 'park'
  iconPack: 'lucide' | 'maki'
  presetId?: string // OSM preset ID, e.g. 'amenity/cafe'
}

export interface ContactInfo {
  phone?: string
  formattedPhone?: string
  email?: string
  website?: string
  socials?: Record<string, string> // platform -> URL
}

export interface Place {
  id: string // A unique identifier
  externalIds: Record<SourceId, string> // Source -> external ID mapping

  name: AttributedValue<string | null>
  description: AttributedValue<string> | null
  placeType: AttributedValue<string>
  geometry: AttributedValue<PlaceGeometry>
  photos: AttributedValue<PlacePhoto>[]
  address: AttributedValue<Address> | null
  contactInfo: {
    phone: AttributedValue<string> | null
    email: AttributedValue<string> | null
    website: AttributedValue<string> | null
    socials: Record<string, AttributedValue<string>>
  }
  openingHours: AttributedValue<OpeningHours> | null
  amenities: Record<string, AttributedValue<string | boolean | number>>
  ratings?: {
    rating: AttributedValue<number>
    reviewCount: AttributedValue<number>
  }
  transit?: AttributedValue<TransitStopInfo> | null
  relations?: AttributedValue<PlaceRelation[]> | null

  // Widget descriptors for additional data sections
  widgets?: WidgetDescriptor[]

  // Nearby category chips for contextual exploration
  nearbyCategories?: NearbyCategory[]

  // Icon/category for display
  icon?: PlaceIcon

  // All sources that contributed data
  sources: SourceReference[]

  // Metadata
  lastUpdated: string // ISO date string
  createdAt: string // ISO date string

  // User-specific data
  bookmark?: Bookmark
  collectionIds?: string[]
}
