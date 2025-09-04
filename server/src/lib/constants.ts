import { IntegrationId } from '../types/integration.types'

/**
 * Data source name constants
 */
export const SOURCE = {
  OSM: 'osm',
  OPENADDRESSES: 'openaddresses',
  GOOGLE: 'google',
  WIKIDATA: 'wikidata',
  YELP: 'yelp',
  FOURSQUARE: 'foursquare',
  TRIPADVISOR: 'tripadvisor',
  OPENTABLE: 'opentable',
  VALHALLA: 'valhalla',
} as const
// TODO: Fix types for source and integration ids
export type Source = (typeof SOURCE)[keyof typeof SOURCE]

/**
 * Data source priorities
 * Higher value = higher priority
 */
export const SOURCE_PRIORITIES = {
  // Primary sources
  [SOURCE.OSM]: 100,
  [SOURCE.OPENADDRESSES]: 90,

  // Secondary sources
  [SOURCE.GOOGLE]: 80,
  [SOURCE.WIKIDATA]: 60,

  // Tertiary sources
  [SOURCE.YELP]: 50,
  [SOURCE.FOURSQUARE]: 40,
  [SOURCE.TRIPADVISOR]: 40,
  [SOURCE.OPENTABLE]: 30,
  [SOURCE.VALHALLA]: 70, // Routing provider - high priority for routing data
} as const

// TODO: Make these constants defined per-capability
/**
 * Integration priorities for capabilities
 * Higher value = higher priority
 */
export const INTEGRATION_PRIORITIES: Partial<Record<IntegrationId, number>> = {
  [IntegrationId.PELIAS]: 100, // Fast, self-hosted, good coverage for place info and search
  [IntegrationId.NOMINATIM]: 90, // Free, rate-limited, good for geocoding
  [IntegrationId.GOOGLE_MAPS]: 80, // Fast, paid, excellent coverage
  [IntegrationId.GEOAPIFY]: 70, // Fast, paid, extensive categories but limited
  [IntegrationId.OVERPASS]: 60, // Slowest, free, supports any OSM tags (fallback)
} as const

// TODO: Remove this
/**
 * Business status constants
 */
export const BUSINESS_STATUS = {
  OPERATIONAL: 'OPERATIONAL',
  CLOSED_TEMPORARILY: 'CLOSED_TEMPORARILY',
  CLOSED_PERMANENTLY: 'CLOSED_PERMANENTLY',
} as const

// TODO: Move these to integration files
// Google API constants
export const GOOGLE_MAPS_PHOTO_URL =
  'https://maps.googleapis.com/maps/api/place/photo'
export const GOOGLE_PLACES_API_URL = 'https://places.googleapis.com/v1/places'
export const DEFAULT_SEARCH_RADIUS = 500 // meters
// Pelias constants
export const PELIAS_API_URL = 'http://pelias_api:4000/v1/autocomplete'
