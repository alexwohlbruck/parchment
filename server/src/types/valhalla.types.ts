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
    }
  }>
  locations: Array<{
    lat: number
    lon: number
    type?: string
    original_index?: number
  }>
  language: string // TODO: We have a type for Locale
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
}

export type ValhallaRouteRequest = {
  locations: Location[]
  costing: string
  costing_options: any // TODO
}

export type ValhallaRouteResponse = {
  trip: Directions
}
