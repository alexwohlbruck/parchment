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
  [SOURCE.GOOGLE]: true,
  [SOURCE.WIKIDATA]: true,
  [SOURCE.YELP]: false, // Not implemented yet
  [SOURCE.FOURSQUARE]: false, // Not implemented yet
} as const
