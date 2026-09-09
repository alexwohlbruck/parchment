// GraphHopper API types based on https://docs.graphhopper.com/openapi/routing/postroute

export interface GraphHopperConfig {
  host?: string // Optional: for self-hosted instances
  apiKey?: string // Optional: for GraphHopper API
}

// Request types
export interface GraphHopperRouteRequest {
  profile: 'car' | 'bike' | 'foot' | 'motorcycle' | 'truck'
  points: number[][] // [longitude, latitude] pairs
  point_hints?: string[]
  snap_preventions?: ('motorway' | 'trunk' | 'bridge' | 'ford' | 'tunnel' | 'ferry')[]
  curbsides?: ('any' | 'right' | 'left')[]
  locale?: string
  elevation?: boolean
  details?: string[]
  optimize?: string
  instructions?: boolean
  calc_points?: boolean
  debug?: boolean
  points_encoded?: boolean
  'ch.disable'?: boolean
  custom_model?: GraphHopperCustomModel
  headings?: number[]
  heading_penalty?: number
  pass_through?: boolean
  algorithm?: 'round_trip' | 'alternative_route'
  'round_trip.distance'?: number
  'round_trip.seed'?: number
  'alternative_route.max_paths'?: number
  'alternative_route.max_weight_factor'?: number
  'alternative_route.max_share_factor'?: number
}

export interface GraphHopperCustomModel {
  speed?: Array<{
    if: string
    limit_to?: string
    multiply_by?: string
  }>
  priority?: Array<{
    if: string
    multiply_by: string
  }>
  distance_influence?: number
  areas?: Record<string, any>
}

// Response types
export interface GraphHopperRouteResponse {
  hints: {
    'visited_nodes.sum'?: number
    'visited_nodes.average'?: number
  }
  info: {
    copyrights: string[]
    took: number
  }
  paths: GraphHopperPath[]
}

export interface GraphHopperPath {
  distance: number // meters
  weight: number
  time: number // milliseconds
  transfers: number
  points_encoded: boolean
  bbox: [number, number, number, number] // [minLon, minLat, maxLon, maxLat]
  points:
    | {
        type: 'LineString'
        coordinates: number[][] // [longitude, latitude] pairs
      }
    | string // encoded polyline
  snapped_waypoints:
    | {
        type: 'LineString'
        coordinates: number[][] // [longitude, latitude] pairs
      }
    | string // encoded polyline
  instructions?: GraphHopperInstruction[]
  details?: Record<string, Array<[number, number, any]>>
  ascend?: number
  descend?: number
  points_order?: number[]
}

export interface GraphHopperInstruction {
  distance: number // meters
  heading?: number
  sign: number
  interval: [number, number]
  text: string
  time: number // milliseconds
  street_name: string
  last_heading?: number
}

// Error response
export interface GraphHopperErrorResponse {
  message: string
  hints?: Array<{
    message: string
    details: string
  }>
}
