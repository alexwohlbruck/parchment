import packageJson from '../../package.json'

export const APP_NAME = 'Parchment Maps'
export const APP_NAME_SHORT = 'Parchment'
export const APP_VERSION = packageJson.version
export const APP_TAGLINE_SHORT = 'The next generation of digital maps'
export const APP_TAGLINE_LONG = 'Explore the world with beautiful, detailed maps crafted by the community'

export const DEFAULT_SERVER_URL = import.meta.env.VITE_SERVER_ORIGIN ||
  (import.meta.env.DEV ? 'http://localhost:5000' : 'https://api.parchment.app')

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
