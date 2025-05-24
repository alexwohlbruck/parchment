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
} as const
// TODO: Fix types for source and integration ids
export type Source = (typeof SOURCE)[keyof typeof SOURCE]

/**
 * Data source priorities
 * Higher value = higher priority
 */
export const SOURCE_PRIORITIES = {
  // Primary sources
  [SOURCE.OSM]: 100, // OpenStreetMap
  [SOURCE.OPENADDRESSES]: 90, // OpenAddresses

  // Secondary sources
  [SOURCE.GOOGLE]: 80, // Google Places
  [SOURCE.WIKIDATA]: 60, // Wikidata

  // Tertiary sources
  [SOURCE.YELP]: 50, // Yelp
  [SOURCE.FOURSQUARE]: 40, // Foursquare
  [SOURCE.TRIPADVISOR]: 40, // TripAdvisor
  [SOURCE.OPENTABLE]: 30, // OpenTable
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
