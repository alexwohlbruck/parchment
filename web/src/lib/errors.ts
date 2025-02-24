export class PlaceNotFoundError extends Error {
  constructor(id: string) {
    super(`Place not found: ${id}`)
    this.name = 'PlaceNotFoundError'
  }
}

export class OverpassError extends Error {
  constructor(message: string) {
    super(`Overpass API error: ${message}`)
    this.name = 'OverpassError'
  }
}
