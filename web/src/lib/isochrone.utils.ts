/**
 * Isochrone helpers.
 *
 * Barrelman returns nested contours — the 30-minute polygon contains the
 * 15-minute one. This module turns that stack into the disjoint bands the map
 * actually draws, and derives the durations and opacities that go with them.
 */

import * as turf from '@turf/turf'
import type {
  IsochroneFeature,
  IsochroneGeometry,
  IsochroneMode,
} from '@server/types/isochrone.types'
import { maxDurationForMode } from '@server/types/isochrone.types'

/** Shortest contour the tool will ask for. */
export const MIN_CONTOUR_MINUTES = 5
/**
 * Longest contour the tool offers. Both mode ceilings are higher (3h street,
 * 2h transit), but an hour is where the answer stops being a place and starts
 * being a region — and where the compute stops being interactive.
 */
export const MAX_CONTOUR_MINUTES = 60
/** Slider granularity, in minutes. */
export const CONTOUR_MINUTE_STEP = 5

/** Band counts the tool offers. */
export const BAND_COUNTS = [1, 3, 5] as const

/** Most opaque fill, used for the innermost (most reachable) band. */
const MAX_BAND_OPACITY = 0.5
/** Least opaque fill, used for the outermost band. */
const MIN_BAND_OPACITY = 0.16

export interface IsochroneBand {
  /** 0 = innermost (shortest) contour. */
  bucket: number
  durationSeconds: number
  durationMinutes: number
  /** The ring itself — this contour minus everything inside it. */
  geometry: IsochroneGeometry
  /** Area of the ring alone, in square meters. */
  areaSquareMeters: number
  /** Area reachable within `durationSeconds` — the ring plus all inner bands. */
  reachableAreaSquareMeters: number
  /** Fill opacity for this band; see `bandOpacities`. */
  opacity: number
  /** Transit only: reachable stops that shaped this contour. */
  stops?: number
}

/**
 * Evenly spaced contour budgets from zero up to `maxMinutes`, in seconds.
 *
 * Even spacing is more than a tidy default: Barrelman can serve evenly spaced
 * street contours out of a single GraphHopper graph search via its `buckets`
 * parameter, so asking for five bands costs about what one band costs.
 */
export function contourDurations(maxMinutes: number, bands: number): number[] {
  if (bands < 1) return []
  const step = maxMinutes / bands
  return Array.from({ length: bands }, (_, i) =>
    Math.round(step * (i + 1) * 60),
  )
}

/**
 * Fill opacity per band, innermost first. Contours are cut into disjoint rings
 * before drawing, so these are the exact opacities that land on the map —
 * nothing compounds where one contour sits inside another.
 *
 * Shading by opacity rather than by lightness keeps the ramp legible over both
 * light and dark basemaps, where a fixed lightness ramp would wash out on one
 * of them.
 */
export function bandOpacities(count: number): number[] {
  if (count < 1) return []
  if (count === 1) return [MAX_BAND_OPACITY]
  const spread = MAX_BAND_OPACITY - MIN_BAND_OPACITY
  return Array.from(
    { length: count },
    (_, i) => MAX_BAND_OPACITY - (i / (count - 1)) * spread,
  )
}

/** Longest contour the API will accept for a mode, in whole minutes. */
export function maxMinutesForMode(mode: IsochroneMode): number {
  return Math.min(
    MAX_CONTOUR_MINUTES,
    Math.floor(maxDurationForMode(mode) / 60),
  )
}

type PolygonGeometry = GeoJSON.Polygon | GeoJSON.MultiPolygon
type PolygonFeature = GeoJSON.Feature<PolygonGeometry>

function asFeature(geometry: IsochroneGeometry): PolygonFeature {
  return turf.feature(geometry as PolygonGeometry)
}

/**
 * Cut nested contours into non-overlapping bands.
 *
 * Drawn as they arrive, the contours stack: the innermost area is painted once
 * per contour containing it, so it reads darker than its opacity says and the
 * boundaries between bands blur into a gradient. Subtracting each contour from
 * the one outside it leaves clean rings that can be drawn at a single, exact
 * opacity each.
 *
 * Features with no geometry (an unroutable origin, a contour that came back
 * empty) are skipped rather than dropped silently onto the map as holes.
 */
export function toIsochroneBands(
  features: IsochroneFeature[],
): IsochroneBand[] {
  const contours = features
    .filter(f => f.geometry != null)
    .sort((a, b) => a.properties.durationSeconds - b.properties.durationSeconds)

  const opacities = bandOpacities(contours.length)
  const bands: IsochroneBand[] = []
  let inner: PolygonFeature | null = null

  contours.forEach((contour, index) => {
    const whole = asFeature(contour.geometry as IsochroneGeometry)
    const ring = inner ? subtract(whole, inner) : whole
    // The previous contour is the union of everything drawn so far, because
    // Barrelman guarantees contours nest.
    inner = whole

    if (!ring) return

    bands.push({
      bucket: index,
      durationSeconds: contour.properties.durationSeconds,
      durationMinutes: contour.properties.durationMinutes,
      geometry: ring.geometry as IsochroneGeometry,
      areaSquareMeters: turf.area(ring),
      reachableAreaSquareMeters: turf.area(whole),
      opacity: opacities[index] ?? MIN_BAND_OPACITY,
      stops: contour.properties.stops,
    })
  })

  return bands
}

/**
 * `outer` minus `inner`. Turf throws on some self-intersecting input that
 * PostGIS was happy to emit; falling back to the undivided contour keeps a
 * band on the map instead of punching a hole in the render.
 */
function subtract(
  outer: PolygonFeature,
  inner: PolygonFeature,
): PolygonFeature | null {
  try {
    return turf.difference(
      turf.featureCollection([outer, inner]),
    ) as PolygonFeature | null
  } catch {
    return outer
  }
}

/**
 * Bands as a GeoJSON FeatureCollection for the map source, outermost first so
 * the shortest contour is drawn last and sits on top.
 */
export function bandsToGeoJson(
  bands: IsochroneBand[],
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [...bands].reverse().map(band => ({
      type: 'Feature' as const,
      properties: {
        bucket: band.bucket,
        durationMinutes: band.durationMinutes,
        opacity: band.opacity,
      },
      geometry: band.geometry as GeoJSON.Geometry,
    })),
  }
}
