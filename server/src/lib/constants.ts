import { IntegrationId } from '../types/integration.types'

/**
 * Data source name constants
 */
export const SOURCE = {
  OSM: 'osm',
  OPENADDRESSES: 'openaddresses',
  GOOGLE: 'google',
  WIKIDATA: 'wikidata',
  WIKIPEDIA: 'wikipedia',
  WIKIMEDIA: 'wikimedia',
  YELP: 'yelp',
  FOURSQUARE: 'foursquare',
  TRIPADVISOR: 'tripadvisor',
  OPENTABLE: 'opentable',
  VALHALLA: 'valhalla',
  GRAPHHOPPER: 'graphhopper',
  GEOAPIFY: 'geoapify',
  TRANSITLAND: 'transitland',
  OVERTURE: 'overture',
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
  [SOURCE.WIKIPEDIA]: 78, // High priority for detailed descriptions
  [SOURCE.TRANSITLAND]: 77, // High priority for transit data
  [SOURCE.OVERTURE]: 76, // Multi-source aggregated data (Overture Maps via Barrelman)
  [SOURCE.GEOAPIFY]: 75,
  [SOURCE.GRAPHHOPPER]: 72, // Routing provider - preferred routing engine
  [SOURCE.VALHALLA]: 70, // Routing provider - high priority for routing data
  [SOURCE.WIKIDATA]: 65,
  [SOURCE.WIKIMEDIA]: 45,

  // Tertiary sources
  [SOURCE.YELP]: 50,
  [SOURCE.FOURSQUARE]: 40,
  [SOURCE.TRIPADVISOR]: 40,
  [SOURCE.OPENTABLE]: 30,
} as const

// TODO: Make these constants defined per-capability
/**
 * Integration priorities for capabilities
 * Higher value = higher priority
 */
export const INTEGRATION_PRIORITIES: Partial<Record<IntegrationId, number>> = {
  [IntegrationId.BARRELMAN]: 105, // Primary OSM engine — search, place info, spatial, tiles
  [IntegrationId.PELIAS]: 100, // Fast, self-hosted, address geocoding (OpenAddresses)
  [IntegrationId.NOMINATIM]: 90, // Free, rate-limited, geocoding fallback
  [IntegrationId.GOOGLE_MAPS]: 80, // Fast, paid, excellent coverage
  [IntegrationId.WIKIPEDIA]: 78, // Free, high-quality detailed descriptions
  [IntegrationId.TRANSITLAND]: 77, // Paid, authoritative transit data
  [IntegrationId.GEOAPIFY]: 70, // Fast, paid, extensive categories but limited
  [IntegrationId.WIKIDATA]: 65, // Free, structured data, good for enrichment
  [IntegrationId.GRAPHHOPPER]: 62, // Fast, free/paid, preferred routing engine with custom models
  [IntegrationId.VALHALLA]: 60, // Fast, free, good coverage for routing
  [IntegrationId.OVERPASS]: 50, // Slowest, free, supports any OSM tags (fallback)
  [IntegrationId.WIKIMEDIA]: 45, // Free, images, depends on Wikidata
} as const

// TODO: Refactor business status to common schema
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
