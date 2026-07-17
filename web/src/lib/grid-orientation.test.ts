/**
 * Unit tests for grid-orientation helpers (city grid orientation lock).
 *
 * Tests cover:
 * - angularDistanceDeg wrap-around
 * - nearestGridBearing 4-fold symmetry + closest pick
 * - findGriddedCity radius matching (NYC in/out)
 */

import { describe, test, expect } from 'vitest'
import {
  angularDistanceDeg,
  nearestGridBearing,
  gridOrientations,
  findGriddedCity,
  GRID_SNAP_THRESHOLD_DEG,
} from './grid-orientation'
import { GridSnapMode } from '@/types/map.types'

describe('angularDistanceDeg', () => {
  test('returns 0 for identical bearings', () => {
    expect(angularDistanceDeg(29, 29)).toBe(0)
  })

  test('takes the short way around the circle', () => {
    expect(angularDistanceDeg(350, 10)).toBe(20)
    expect(angularDistanceDeg(10, 350)).toBe(20)
  })

  test('caps at 180', () => {
    expect(angularDistanceDeg(0, 180)).toBe(180)
  })

  test('normalizes out-of-range inputs', () => {
    expect(angularDistanceDeg(-10, 350)).toBe(0)
    expect(angularDistanceDeg(389, 29)).toBe(0)
  })
})

describe('gridOrientations', () => {
  test('NORTH_UP yields only the upright orientation', () => {
    expect(gridOrientations(29, GridSnapMode.NORTH_UP)).toEqual([29])
    // A grid past 45° folds to the negative side (nearest north).
    expect(gridOrientations(70, GridSnapMode.NORTH_UP)).toEqual([340])
    // 90°-equivalent grids resolve to the same upright orientation.
    expect(gridOrientations(119, GridSnapMode.NORTH_UP)).toEqual([29])
  })

  test('ALL yields the four 90°-rotated orientations', () => {
    expect(gridOrientations(29, GridSnapMode.ALL)).toEqual([29, 119, 209, 299])
  })

  test('NORTH_UP keeps both near-north orientations at the 45° tie', () => {
    // Boston's grid reads 315° (≡ 45°): both 45° and 315° are 45° from north.
    expect(gridOrientations(315, GridSnapMode.NORTH_UP).sort((a, b) => a - b)).toEqual([45, 315])
  })

  test('OFF yields no targets', () => {
    expect(gridOrientations(29, GridSnapMode.OFF)).toEqual([])
  })
})

describe('nearestGridBearing', () => {
  test('snaps to the grid axis when nearby (ALL)', () => {
    expect(nearestGridBearing(27, 29, GridSnapMode.ALL)).toBe(29)
  })

  test('ALL picks the closest of the four 90°-symmetric orientations', () => {
    // Manhattan grid (29°) → {29, 119, 209, 299}
    expect(nearestGridBearing(116, 29, GridSnapMode.ALL)).toBe(119)
    expect(nearestGridBearing(205, 29, GridSnapMode.ALL)).toBe(209)
    expect(nearestGridBearing(300, 29, GridSnapMode.ALL)).toBe(299)
  })

  test('NORTH_UP only ever returns the upright orientation', () => {
    // Even released near a sideways orientation, the only target is 29°.
    expect(nearestGridBearing(116, 29, GridSnapMode.NORTH_UP)).toBe(29)
    expect(angularDistanceDeg(116, nearestGridBearing(116, 29, GridSnapMode.NORTH_UP))).toBeGreaterThan(
      GRID_SNAP_THRESHOLD_DEG,
    ) // → caller won't snap a sideways release in north-up mode
  })

  test('NORTH_UP snaps to a CCW-tilted grid expressed as ~315°', () => {
    // Regression: Boston's 315° grid must snap when released near 315°, not
    // get collapsed to 45° (which would be 90° away and never snap).
    expect(nearestGridBearing(312, 315, GridSnapMode.NORTH_UP)).toBe(315)
    expect(nearestGridBearing(47, 315, GridSnapMode.NORTH_UP)).toBe(45)
  })

  test('OFF leaves the bearing unchanged (no snap target)', () => {
    expect(nearestGridBearing(123, 29, GridSnapMode.OFF)).toBe(123)
  })

  test('folds the grid bearing into 0–90 before expanding', () => {
    // 119 is the same grid as 29; results must match.
    expect(nearestGridBearing(27, 119, GridSnapMode.ALL)).toBe(29)
  })

  test('a near-north release stays far from the NYC grid (no false snap)', () => {
    // Mapbox handles north snap; our grid target must be > threshold from 0.
    const target = nearestGridBearing(0, 29, GridSnapMode.ALL)
    expect(angularDistanceDeg(0, target)).toBeGreaterThan(GRID_SNAP_THRESHOLD_DEG)
  })
})

describe('findGriddedCity', () => {
  test('matches a point inside Manhattan', () => {
    const city = findGriddedCity({ lng: -73.985, lat: 40.758 }) // Times Square
    expect(city?.name).toContain('Manhattan')
    expect(city?.bearing).toBe(29)
  })

  test('matches other dataset cities', () => {
    expect(findGriddedCity({ lng: 2.1686, lat: 41.3874 })?.name).toContain('Barcelona') // Eixample
    expect(findGriddedCity({ lng: -58.3816, lat: -34.6037 })?.name).toContain('Buenos Aires')
  })

  test('returns null far from any gridded city', () => {
    expect(findGriddedCity({ lng: 2.3522, lat: 48.8566 })).toBeNull() // Paris
    expect(findGriddedCity({ lng: 139.6917, lat: 35.6895 })).toBeNull() // Tokyo
  })
})
