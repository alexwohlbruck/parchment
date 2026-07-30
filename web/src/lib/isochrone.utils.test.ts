/**
 * Unit tests for isochrone utilities.
 *
 * The load-bearing behaviour here is band cutting: Barrelman returns nested
 * contours, and drawing them as-is stacks translucent fills. These tests pin
 * down that the contours come back as disjoint rings that still add up to the
 * original reachable area.
 */

import { describe, test, expect } from 'vitest'
import * as turf from '@turf/turf'
import {
  BAND_COUNTS,
  MAX_CONTOUR_MINUTES,
  MIN_CONTOUR_MINUTES,
  bandOpacities,
  bandsToGeoJson,
  contourDurations,
  maxMinutesForMode,
  toIsochroneBands,
} from './isochrone.utils'
import type {
  IsochroneFeature,
  IsochronePolygon,
} from '@server/types/isochrone.types'

/** Axis-aligned square centred on null island, `half` degrees to a side. */
function square(half: number): IsochronePolygon {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [-half, -half],
        [half, -half],
        [half, half],
        [-half, half],
        [-half, -half],
      ],
    ],
  }
}

function contour(
  durationSeconds: number,
  geometry: IsochronePolygon | null,
  bucket = 0,
): IsochroneFeature {
  return {
    type: 'Feature',
    properties: {
      mode: 'walk',
      durationSeconds,
      durationMinutes: durationSeconds / 60,
      bucket,
    },
    geometry,
  }
}

function areaOf(geometry: IsochronePolygon): number {
  return turf.area(turf.feature(geometry as GeoJSON.Polygon))
}

describe('isochrone.utils', () => {
  describe('contourDurations', () => {
    test('spaces contours evenly from zero, in seconds', () => {
      expect(contourDurations(30, 3)).toEqual([600, 1200, 1800])
    })

    test('a single band is just the full budget', () => {
      expect(contourDurations(15, 1)).toEqual([900])
    })

    test('stays evenly spaced from zero when the split is fractional', () => {
      // Barrelman only takes the single-graph-search shortcut when each
      // duration is a whole multiple of the first, so this must not drift.
      const durations = contourDurations(50, 3)
      expect(durations).toEqual([1000, 2000, 3000])
    })

    test('every offered band count divides the range evenly', () => {
      for (const bands of BAND_COUNTS) {
        const durations = contourDurations(MAX_CONTOUR_MINUTES, bands)
        expect(durations).toHaveLength(bands)
        const step = durations[0]
        durations.forEach((d, i) => expect(d).toBe(step * (i + 1)))
      }
    })

    test('returns nothing for a nonsensical band count', () => {
      expect(contourDurations(30, 0)).toEqual([])
    })
  })

  describe('bandOpacities', () => {
    test('fades from the innermost band outward', () => {
      const opacities = bandOpacities(5)
      expect(opacities).toHaveLength(5)
      for (let i = 1; i < opacities.length; i++) {
        expect(opacities[i]).toBeLessThan(opacities[i - 1])
      }
    })

    test('a lone band gets the most opaque fill', () => {
      const [only] = bandOpacities(1)
      expect(only).toBe(bandOpacities(3)[0])
    })

    test('stays within a legible range', () => {
      for (const opacity of bandOpacities(8)) {
        expect(opacity).toBeGreaterThan(0.1)
        expect(opacity).toBeLessThanOrEqual(0.5)
      }
    })
  })

  describe('maxMinutesForMode', () => {
    test('street modes reach the tool ceiling', () => {
      expect(maxMinutesForMode('walk')).toBe(MAX_CONTOUR_MINUTES)
      expect(maxMinutesForMode('car')).toBe(MAX_CONTOUR_MINUTES)
    })

    test('transit is never offered more than the API allows', () => {
      expect(maxMinutesForMode('transit')).toBeLessThanOrEqual(120)
      expect(maxMinutesForMode('transit')).toBeGreaterThanOrEqual(
        MIN_CONTOUR_MINUTES,
      )
    })
  })

  describe('toIsochroneBands', () => {
    const small = square(0.01)
    const mid = square(0.02)
    const large = square(0.03)
    const nested = [
      contour(600, small, 0),
      contour(1200, mid, 1),
      contour(1800, large, 2),
    ]

    test('returns one band per contour', () => {
      expect(toIsochroneBands(nested)).toHaveLength(3)
    })

    test('reports cumulative reachable area, not just the ring', () => {
      const bands = toIsochroneBands(nested)
      expect(bands[0].reachableAreaSquareMeters).toBeCloseTo(areaOf(small), -1)
      expect(bands[2].reachableAreaSquareMeters).toBeCloseTo(areaOf(large), -1)
    })

    test('cuts nested contours into disjoint rings', () => {
      const bands = toIsochroneBands(nested)
      // The innermost band is the whole contour; the rest are rings.
      expect(bands[0].areaSquareMeters).toBeCloseTo(areaOf(small), -1)
      expect(bands[1].areaSquareMeters).toBeCloseTo(
        areaOf(mid) - areaOf(small),
        -1,
      )
      expect(bands[2].areaSquareMeters).toBeCloseTo(
        areaOf(large) - areaOf(mid),
        -1,
      )
    })

    test('the rings still add up to the outermost contour', () => {
      const bands = toIsochroneBands(nested)
      const summed = bands.reduce((acc, b) => acc + b.areaSquareMeters, 0)
      expect(summed).toBeCloseTo(areaOf(large), -1)
    })

    test('rings do not overlap each other', () => {
      const bands = toIsochroneBands(nested)
      const outer = turf.feature(bands[2].geometry as GeoJSON.Polygon)
      const inner = turf.feature(bands[0].geometry as GeoJSON.Polygon)
      const overlap = turf.intersect(turf.featureCollection([outer, inner]))
      expect(overlap == null || turf.area(overlap) < 1).toBe(true)
    })

    test('orders bands by duration regardless of arrival order', () => {
      const shuffled = [nested[2], nested[0], nested[1]]
      const bands = toIsochroneBands(shuffled)
      expect(bands.map(b => b.durationSeconds)).toEqual([600, 1200, 1800])
      expect(bands.map(b => b.bucket)).toEqual([0, 1, 2])
    })

    test('opacity fades outward across the returned bands', () => {
      const bands = toIsochroneBands(nested)
      expect(bands[0].opacity).toBeGreaterThan(bands[2].opacity)
    })

    test('skips contours that came back empty', () => {
      const bands = toIsochroneBands([
        contour(600, null, 0),
        contour(1200, mid, 1),
      ])
      expect(bands).toHaveLength(1)
      expect(bands[0].durationSeconds).toBe(1200)
    })

    test('handles a single contour', () => {
      const bands = toIsochroneBands([contour(900, mid)])
      expect(bands).toHaveLength(1)
      expect(bands[0].areaSquareMeters).toBeCloseTo(
        bands[0].reachableAreaSquareMeters,
        -1,
      )
    })

    test('carries transit stop counts through', () => {
      const withStops = contour(1200, mid, 0)
      withStops.properties.stops = 42
      expect(toIsochroneBands([withStops])[0].stops).toBe(42)
    })

    test('returns nothing when there is nothing to draw', () => {
      expect(toIsochroneBands([])).toEqual([])
    })
  })

  describe('bandsToGeoJson', () => {
    test('emits the outermost band first so the shortest draws on top', () => {
      const bands = toIsochroneBands([
        contour(600, square(0.01), 0),
        contour(1200, square(0.02), 1),
        contour(1800, square(0.03), 2),
      ])
      const collection = bandsToGeoJson(bands)

      expect(collection.type).toBe('FeatureCollection')
      expect(collection.features.map(f => f.properties?.bucket)).toEqual([
        2, 1, 0,
      ])
    })

    test('carries each band opacity onto the feature for the fill expression', () => {
      const bands = toIsochroneBands([contour(900, square(0.02))])
      const [feature] = bandsToGeoJson(bands).features
      expect(feature.properties?.opacity).toBe(bands[0].opacity)
    })

    test('is empty for no bands', () => {
      expect(bandsToGeoJson([]).features).toEqual([])
    })
  })
})
