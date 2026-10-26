type Rgb = [number, number, number]

export type DeckPalette = {
  surface: Rgb
  concrete: Rgb
  parapet: Rgb
  /** A rail deck's surface. */
  track: Rgb
  /** The top of a road deck that has its carriageway laid on it: beside the carriageway the colour of the ground's paths, as its sidewalks are. */
  deck: Rgb
  /** Below street zoom, a deck's surface: the basemap's colour for its minor, major and highway roads, and paths. */
  lowRoad: Rgb
  lowMajor: Rgb
  lowHighway: Rgb
  lowPath: Rgb
  /** A sidewalk or footpath laid on a deck, and a rail. */
  walkway: Rgb
  rail: Rgb
  white: [number, number, number]
  yellow: [number, number, number]
  green: [number, number, number]
  red: [number, number, number]
  route: [number, number, number]
  routeCasing: [number, number, number]
  travelled: [number, number, number]
  travelledCasing: [number, number, number]
}

export type RouteMeasure = (lngLat: [number, number], from: number) => number

/** Metres along a route, from and to. */
export type RouteSpan = [start: number, end: number]

/** What the decks know of a route source beyond its line. */
export type RouteTrack = {
  /** Metres along the route at a lng/lat, searched on from `from`, so its travelled part can be drawn apart. */
  measure: RouteMeasure
  /** Metres right of its line the route is drawn. */
  offset?: number
  /** Whether the route may ride a deck at a distance along it; by default anywhere a deck runs its way. */
  rides?: (metres: number) => boolean
  /** Hears the stretches laid over decks each time they are laid again. */
  laid?: (spans: RouteSpan[]) => void
}

export type DeckSources = {
  profiles: { source: string; layer: string }
  /** Source ids whose lines are routes to lay over decks. */
  routes: () => string[]
  track?: (source: string) => RouteTrack | null
  /** Whether the lane-level roads are drawn: without them a deck keeps the basemap's road colours at every zoom. */
  hd?: () => boolean
}

