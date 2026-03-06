/**
 * Unit tests for measure utilities (polygon distance/area and circle metrics).
 * Used by both the Distance (polygon) and Circle measure tools.
 */

import { describe, test, expect } from 'vitest'
import {
  distanceMeters,
  pathLengthMeters,
  polygonAreaSquareMeters,
  circleCircumferenceMeters,
  circleAreaSquareMeters,
  shouldCloseLoop,
  findSegmentToInsert,
  distancePx,
  formatMeasureDistance,
  formatMeasureArea,
} from './measure.utils'
import type { LngLat } from '@/types/map.types'
import type { Point2D } from './measure.utils'

describe('measure.utils', () => {
  describe('distanceMeters', () => {
    test('is symmetric and returns positive distance for distinct points', () => {
      const a: LngLat = { lng: -122.4194, lat: 37.7749 }
      const b: LngLat = { lng: -122.4094, lat: 37.7849 }
      expect(distanceMeters(a, b)).toBe(distanceMeters(b, a))
      expect(distanceMeters(a, b)).toBeGreaterThan(0)
    })
  })

  describe('pathLengthMeters', () => {
    test('sums segment lengths for multiple points', () => {
      const a: LngLat = { lng: 0, lat: 0 }
      const b: LngLat = { lng: 0.001, lat: 0 }
      const c: LngLat = { lng: 0.001, lat: 0.001 }
      const expected = distanceMeters(a, b) + distanceMeters(b, c)
      expect(pathLengthMeters([a, b, c])).toBeCloseTo(expected, 5)
    })
  })

  describe('polygonAreaSquareMeters', () => {
    test('returns 0 for fewer than 3 points', () => {
      expect(polygonAreaSquareMeters([])).toBe(0)
      expect(polygonAreaSquareMeters([{ lng: 0, lat: 0 }, { lng: 1, lat: 0 }])).toBe(0)
    })

    test('closes ring when first and last point differ', () => {
      const openRing: LngLat[] = [
        { lng: -122.42, lat: 37.77 },
        { lng: -122.41, lat: 37.77 },
        { lng: -122.415, lat: 37.78 },
      ]
      expect(polygonAreaSquareMeters(openRing)).toBeGreaterThan(0)
    })
  })

  describe('circleCircumferenceMeters / circleAreaSquareMeters', () => {
    test('circle formulas match 2πr and πr²', () => {
      const r = 1000
      expect(circleCircumferenceMeters(r)).toBeCloseTo(2 * Math.PI * r, 5)
      expect(circleAreaSquareMeters(r)).toBeCloseTo(Math.PI * r * r, 5)
    })
  })

  describe('distancePx', () => {
    test('returns Euclidean distance', () => {
      expect(distancePx({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
    })
  })

  describe('shouldCloseLoop', () => {
    test('true when click within threshold of first point, false when beyond', () => {
      const first: LngLat = { lng: 0, lat: 0 }
      const project = (p: LngLat) => ({ x: p.lng * 100, y: p.lat * 100 })
      const points: LngLat[] = [first, { lng: 1, lat: 0 }, { lng: 1, lat: 1 }]
      const firstPx = project(first)
      expect(shouldCloseLoop(points, { lngLat: first, point: { x: firstPx.x + 5, y: firstPx.y } }, project, 12)).toBe(true)
      expect(shouldCloseLoop(points, { lngLat: { lng: 0.5, lat: 0.5 }, point: { x: firstPx.x + 100, y: firstPx.y + 100 } }, project, 12)).toBe(false)
    })
  })

  describe('findSegmentToInsert', () => {
    test('returns segment and interpolated point when click near segment, null when far', () => {
      const points: LngLat[] = [{ lng: 0, lat: 0 }, { lng: 1, lat: 0 }]
      const project = (p: LngLat) => ({ x: p.lng * 100, y: p.lat * 100 })
      const near = findSegmentToInsert(points, { lngLat: { lng: 0.5, lat: 0 }, point: { x: 50, y: 2 } }, project, 12)
      expect(near).not.toBeNull()
      expect(near!.segmentIndex).toBe(0)
      expect(near!.point.lng).toBeCloseTo(0.5, 5)
      const far = findSegmentToInsert(points, { lngLat: { lng: 0.5, lat: 1 }, point: { x: 50, y: 200 } }, project, 12)
      expect(far).toBeNull()
    })
  })

  describe('formatMeasureDistance / formatMeasureArea', () => {
    test('format with expected unit labels for metric and imperial', () => {
      expect(formatMeasureDistance(500, 'metric')).toMatch(/\d+\s*m/)
      expect(formatMeasureDistance(2000, 'imperial')).toMatch(/\d+\s*mi/)
      expect(formatMeasureArea(10000, 'metric')).toMatch(/m²|km²/)
      expect(formatMeasureArea(5000, 'imperial')).toMatch(/ft²|ac|mi²/)
    })
  })
})
