export type Location = {
  type: 'coordinates' // | 'place' | 'address'
  value: [number, number] // | string
}

export type Directions = {
  legs: Array<{
    shape: string
    summary: {
      length: number
      time: number
      has_toll?: boolean
      has_highway?: boolean
      has_ferry?: boolean
    }
    maneuvers: ValhallaManeuver[]
  }>
  locations: Array<{
    lat: number
    lon: number
    type?: string
    original_index?: number
  }>
  language: import('../lib/i18n').Language
  status: number
  status_message: string
  summary: {
    cost: number
    has_ferry: boolean
    has_highway: boolean
    has_time_restrictions: boolean
    has_toll: boolean
    length: number
    max_lat: number
    max_lon: number
    min_lat: number
    min_lon: number
    time: number
  }
  units: string
  shape: string
}

export type ValhallaConfig = {
  host: string
}

export type ValhallaResponse = {
  trip: Directions
}

export type ValhallaEdgeSegment = {
  startDistance: number
  endDistance: number
  surface: string
  roadClass: string
  use: string
  cycleLane?: string
  shoulder?: boolean
  speedLimit?: number
  laneCount?: number
  weightedGrade?: number
  meanElevation?: number
}

export type ValhallaElevationStats = {
  totalGain: number
  totalLoss: number
  maxElevation: number
  minElevation: number
}

export type ValhallaLeg = {
  shape: string
  summary: {
    length: number
    time: number
    has_toll?: boolean
    has_highway?: boolean
    has_ferry?: boolean
  }
  maneuvers: ValhallaManeuver[]
  // Enrichment fields (from Barrelman /route endpoint)
  elevation?: number[]
  edge_segments?: ValhallaEdgeSegment[]
  elevation_stats?: ValhallaElevationStats
}

export type ValhallaManeuver = {
  type: number
  instruction: string
  length: number
  time: number
  street_names?: string[]
  begin_shape_index?: number
  end_shape_index?: number
  sign?: {
    exit_number?: string
  }
}

export type ValhallaRouteRequest = {
  locations: Location[]
  costing: string
  costing_options?: any // TODO
}

export type ValhallaRouteResponse = {
  trip: Directions
}
