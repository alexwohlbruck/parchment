export const DEFAULT_SERVER_URL = 'https://api.parchment.app'

export const MarkerIds = {
  SELECTED_POI: 'selected-poi',
} as const

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
