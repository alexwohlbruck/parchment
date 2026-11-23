/**
 * Per-region packages that let the app search, show departures and plan trips
 * with no connection. Barrelman builds them for a bounding box; the native apps
 * read the same files. Coordinates are WGS 84, rounded to 6 decimals.
 */

export type PackageBounds = [west: number, south: number, east: number, north: number]

export const OFFLINE_PACKAGE_VERSION = 1

export type OfflinePackageKind = 'places' | 'timetable' | 'streets'

interface PackageHeader {
  version: typeof OFFLINE_PACKAGE_VERSION
  bounds: PackageBounds
  generatedAt: string
}

export interface PackagePlaceAddress {
  housenumber?: string
  street?: string
  unit?: string
  city?: string
  state?: string
  postcode?: string
}

export interface PackageTransitRoute {
  shortName: string
  color?: string
  type: number
}

/** A named place or transit stop. `id` is an OSM id (`node/1`) or `stop/<feedId>/<stopId>`. */
export interface PackagePlace {
  id: string
  name: string
  /** Primary preset category, e.g. `amenity/cafe`. */
  category: string | null
  lng: number
  lat: number
  address?: PackagePlaceAddress
  /** OSM `opening_hours` syntax. */
  hours?: string
  phone?: string
  website?: string
  transit?: { feedId: string; stopId: string; routes: PackageTransitRoute[] }
  /** Added by the Parchment server: the preset's name and icon in the request's language. */
  placeType?: string
  icon?: string
  iconPack?: 'lucide' | 'maki'
}

export interface PlacesPackage extends PackageHeader {
  places: PackagePlace[]
}

export interface TimetableFeed {
  id: string
  timezone: string
}

export interface TimetableStop {
  feed: number
  stopId: string
  name: string
  lng: number
  lat: number
  /** Index of the parent station in `stops`, when the station is also in the region. */
  parent?: number
}

export interface TimetableRoute {
  feed: number
  routeId: string
  shortName: string
  longName: string
  /** GTFS `route_type`. */
  type: number
  color?: string
  textColor?: string
  agency?: string
}

/** Trips that call at the same stops in the same order, for one route and headsign. */
export interface TimetablePattern {
  route: number
  headsign: string
  directionId?: number
  /** Indexes into `stops`, only the calls inside the region. */
  stops: number[]
}

export interface TimetableTrip {
  pattern: number
  tripId: string
  /** Bit `d` is set when the trip runs on the service day `startDate + d`. */
  days: number
  /**
   * Arrival then departure at each of the pattern's stops, in seconds after the
   * service day's noon minus 12 h (GTFS time), delta-encoded: the first value is
   * absolute, each following one is the difference from the previous.
   */
  times: number[]
}

export interface TimetablePackage extends PackageHeader {
  /** First service day, `YYYYMMDD`. */
  startDate: string
  days: number
  feeds: TimetableFeed[]
  stops: TimetableStop[]
  routes: TimetableRoute[]
  patterns: TimetablePattern[]
  trips: TimetableTrip[]
  /** Walking transfers between stops: `[from, to, seconds]`, indexes into `stops`. */
  transfers: [number, number, number][]
}

export const STREET_FLAGS = {
  FOOT: 1,
  BIKE: 2,
  /** Cyclists may only ride from `from` to `to`. */
  BIKE_FORWARD_ONLY: 4,
  /** Cyclists may only ride from `to` to `from`. */
  BIKE_BACKWARD_ONLY: 8,
  STEPS: 16,
  /** A cycleway, or a road with a bike lane or track. */
  BIKE_LANE: 32,
  /** A path or footway away from traffic. */
  CAR_FREE: 64,
  /** A busy road: primary, secondary or trunk. */
  BUSY: 128,
} as const

/**
 * A walk and bike street graph. Integers are coordinates × 1e6.
 *
 * - `nodes`: flat `[lng, lat, …]`, delta-encoded across the whole array per axis.
 * - `edges`: flat records of 6 — `from`, `to` (node indexes), length in
 *   decimetres, `STREET_FLAGS`, index into `names` or -1, and the number of
 *   intermediate shape points.
 * - `shapes`: the intermediate points of every edge in order, flat
 *   `[lng, lat, …]`, each delta-encoded from the previous point of its edge
 *   (the first from the edge's `from` node).
 */
export interface StreetsPackage extends PackageHeader {
  nodes: number[]
  edges: number[]
  shapes: number[]
  names: string[]
}

export const STREET_EDGE_STRIDE = 6
