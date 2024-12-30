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
}

export type ValhallaRouteRequest = {
  locations: Location[]
  costing: string
  costing_options: any // TODO
}

export type ValhallaRouteResponse = {
  trip: Directions
}
