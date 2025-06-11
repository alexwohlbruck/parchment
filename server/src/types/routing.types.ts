import { SOURCE } from '../lib/constants'

export interface RouteCoordinate {
  lat: number
  lng: number
}

export interface RouteLeg {
  /** Encoded polyline shape of the leg */
  shape: string
  /** Distance of the leg in meters */
  distance: number
  /** Time to travel the leg in seconds */
  time: number
  /** Array of maneuvers/instructions for this leg */
  maneuvers?: RouteManeuver[]
  /** Summary information for this leg */
  summary?: {
    length: number // in meters
    time: number // in seconds
  }
}

export interface RouteManeuver {
  /** Instruction text */
  instruction: string
  /** Distance to the maneuver in meters */
  distance: number
  /** Time to the maneuver in seconds */
  time: number
  /** Type of maneuver (turn, merge, etc.) */
  type: string
  /** Coordinate where maneuver occurs */
  coordinate?: RouteCoordinate
}

export interface RouteSummary {
  /** Total distance in meters */
  distance: number
  /** Total time in seconds */
  time: number
  /** Bounding box of the route */
  bounds?: {
    minLat: number
    minLng: number
    maxLat: number
    maxLng: number
  }
  /** Additional summary flags */
  hasFerry?: boolean
  hasHighway?: boolean
  hasToll?: boolean
  hasTimeRestrictions?: boolean
}

export interface UnifiedRoute {
  /** Array of route legs */
  legs: RouteLeg[]
  /** Start and end locations */
  locations: RouteCoordinate[]
  /** Overall route summary */
  summary: RouteSummary
  /** Language of instructions */
  language: string
  /** Units used (kilometers, miles) */
  units: string
  /** Source provider information */
  source: {
    id: string
    name: string
    url?: string
  }
  /** Status information */
  status: {
    code: number
    message: string
  }
  /** Raw response data for debugging */
  raw?: any
}

export interface RouteRequest {
  /** Array of locations to route between */
  locations: Array<{
    lat: number
    lng: number
  }>
  /** Routing profile/costing model */
  costing: string
  /** Additional routing options */
  options?: {
    units?: 'kilometers' | 'miles'
    language?: string
    avoid?: string[]
    [key: string]: any
  }
}
