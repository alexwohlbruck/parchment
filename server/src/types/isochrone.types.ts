/**
 * Isochrone types — Barrelman's `/isochrone` contract.
 *
 * Parchment proxies isochrone requests rather than computing them, so these
 * shapes belong to Barrelman. They live here so the web client can import them
 * through the `@server` alias instead of redeclaring a second copy that drifts.
 *
 * Geometry is spelled out rather than pulled from `@types/geojson` because the
 * server compiles with `types: ["bun-types"]` only; the shapes are structurally
 * identical, so web-side GeoJSON consumers accept them unchanged.
 */

export const ISOCHRONE_MODES = ['walk', 'bike', 'car', 'transit'] as const

export type IsochroneMode = (typeof ISOCHRONE_MODES)[number]

/** Longest street-mode contour Barrelman will compute (3h, seconds). */
export const MAX_STREET_DURATION = 10_800

/** Longest transit contour (2h, seconds) — MOTIS cost grows with the window. */
export const MAX_TRANSIT_DURATION = 7_200

/** Most contours Barrelman accepts in a single request. */
export const MAX_CONTOURS = 8

export interface IsochronePolygon {
  type: 'Polygon'
  coordinates: number[][][]
}

export interface IsochroneMultiPolygon {
  type: 'MultiPolygon'
  coordinates: number[][][][]
}

export type IsochroneGeometry = IsochronePolygon | IsochroneMultiPolygon

export interface IsochroneFeatureProperties {
  mode: IsochroneMode
  durationSeconds: number
  durationMinutes: number
  /** 0 = innermost (shortest) contour, matching GraphHopper's convention. */
  bucket: number
  /** Transit only: reachable stops that shaped this contour. */
  stops?: number
}

export interface IsochroneFeature {
  type: 'Feature'
  properties: IsochroneFeatureProperties
  /** Null when the contour came back empty (unroutable origin, say). */
  geometry: IsochroneGeometry | null
}

export interface IsochroneResponse {
  mode: IsochroneMode
  origin: { lat: number; lng: number }
  arriveBy: boolean
  /** Resolved query time (transit only). */
  time?: string
  /** Ordered smallest contour first, so renderers draw back to front. */
  isochrones: {
    type: 'FeatureCollection'
    features: IsochroneFeature[]
  }
  meta: {
    durations: number[]
    computeMs: number
    reachableStops?: number
    stopIsochrones?: number
    stopGridMeters?: number
    truncated?: boolean
  }
}

/** Parameters accepted by `GET /proxy/isochrone`. */
export interface IsochroneQuery {
  lat: number
  lng: number
  mode?: IsochroneMode
  /** Contour budgets in seconds, ascending. */
  durations?: number[]
  /** Reverse isochrone — the area that can *reach* the point. */
  arriveBy?: boolean
  /** ISO 8601 departure (or arrival) time. Transit only. */
  time?: string
  /** Douglas–Peucker tolerance in meters. */
  simplify?: number
}

/** Ceiling for a duration in the given mode, in seconds. */
export function maxDurationForMode(mode: IsochroneMode): number {
  return mode === 'transit' ? MAX_TRANSIT_DURATION : MAX_STREET_DURATION
}
