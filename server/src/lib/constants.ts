/**
 * Data source name constants
 */
export const SOURCE = {
  OSM: 'osm',
  GOOGLE: 'google',
  WIKIDATA: 'wikidata',
  YELP: 'yelp',
  FOURSQUARE: 'foursquare',
  TRIPADVISOR: 'tripadvisor',
  OPENTABLE: 'opentable',
  PELIAS: 'pelias',
} as const

/**
 * Data source priorities
 * Higher value = higher priority
 */
export const SOURCE_PRIORITIES = {
  // Primary sources
  [SOURCE.OSM]: 100, // OpenStreetMap

  // Secondary sources
  [SOURCE.GOOGLE]: 80, // Google Places
  [SOURCE.WIKIDATA]: 60, // Wikidata

  // Tertiary sources
  [SOURCE.YELP]: 50, // Yelp
  [SOURCE.FOURSQUARE]: 40, // Foursquare
  [SOURCE.TRIPADVISOR]: 40, // TripAdvisor
  [SOURCE.OPENTABLE]: 30, // OpenTable
} as const

/**
 * Business status constants
 */
export const BUSINESS_STATUS = {
  OPERATIONAL: 'OPERATIONAL',
  CLOSED_TEMPORARILY: 'CLOSED_TEMPORARILY',
  CLOSED_PERMANENTLY: 'CLOSED_PERMANENTLY',
} as const

/**
 * API configuration
 */
export const API_CONFIG = {
  [SOURCE.OSM]: true, // Always enabled
  [SOURCE.GOOGLE]: true, //!!process.env.GOOGLE_MAPS_API_KEY,
  [SOURCE.WIKIDATA]: true, // Always enabled
  [SOURCE.PELIAS]: false, // Always enabled, hosted locally
  [SOURCE.YELP]: false, // Not implemented yet
  [SOURCE.FOURSQUARE]: false, // Not implemented yet
} as const

// Google API constants
export const GOOGLE_MAPS_PHOTO_URL =
  'https://maps.googleapis.com/maps/api/place/photo'
export const GOOGLE_PLACES_API_URL = 'https://places.googleapis.com/v1/places'
export const DEFAULT_SEARCH_RADIUS = 500 // meters

// Pelias constants
export const PELIAS_API_URL = 'http://pelias_api:4000/v1/autocomplete'
