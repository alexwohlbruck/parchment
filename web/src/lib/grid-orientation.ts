import { GRIDDED_CITIES, type GriddedCity } from '@/constants/gridded-cities'
import { GridSnapMode } from '@/types/map.types'

/**
 * Degrees within which a rotation gesture snaps to a grid-aligned bearing.
 * Matches Mapbox GL's default `bearingSnap` (7°) used for north-up snapping,
 * so grid snapping feels identical to the native north snap.
 */
export const GRID_SNAP_THRESHOLD_DEG = 7

const EARTH_RADIUS_KM = 6371

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/** Great-circle distance between two lng/lat points, in kilometers. */
function distanceKm(
  a: { lng: number; lat: number },
  b: { lng: number; lat: number },
): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h))
}

/** Normalize an angle to the [0, 360) range. */
function normalizeBearing(deg: number): number {
  return ((deg % 360) + 360) % 360
}

/** Smallest absolute angle between two bearings, in [0, 180]. */
export function angularDistanceDeg(a: number, b: number): number {
  const diff = normalizeBearing(a - b)
  return diff > 180 ? 360 - diff : diff
}

/**
 * The gridded city whose activation radius currently contains `center`, or
 * null if none do. When radii overlap, the nearest city center wins.
 */
export function findGriddedCity(center: {
  lng: number
  lat: number
}): GriddedCity | null {
  let best: GriddedCity | null = null
  let bestDist = Infinity
  for (const city of GRIDDED_CITIES) {
    const d = distanceKm(center, city.center)
    if (d <= city.radiusKm && d < bestDist) {
      best = city
      bestDist = d
    }
  }
  return best
}

/**
 * The grid-aligned bearings worth snapping to, given the snap mode:
 * - NORTH_UP: just the grid's upright orientation (its primary axis folded to
 *   the bearing nearest north).
 * - ALL: all four 90°-rotated orientations of the grid.
 */
export function gridOrientations(
  gridBearing: number,
  mode: GridSnapMode,
): number[] {
  if (mode === GridSnapMode.OFF) return []
  const base = normalizeBearing(gridBearing) % 90 // primary axis folded into 0–90°
  const all = [0, 1, 2, 3].map(k => normalizeBearing(base + k * 90))
  if (mode === GridSnapMode.ALL) return all
  // NORTH_UP: keep only the orientation(s) no more than 45° from north — i.e.
  // the most-upright one (e.g. NYC 29° → 29°, a 70° grid → 340°). At the exact
  // 45° tie (e.g. Boston's 315°≡45° grid) both near-north orientations qualify,
  // so a release at either one still snaps.
  return all.filter(o => angularDistanceDeg(o, 0) <= 45 + 1e-9)
}

/**
 * Given the current map bearing and a grid's primary-axis heading, return the
 * grid-aligned bearing closest to `current` for the given snap mode. The caller
 * decides, via `angularDistanceDeg` against `GRID_SNAP_THRESHOLD_DEG`, whether
 * `current` is close enough to actually snap.
 */
export function nearestGridBearing(
  current: number,
  gridBearing: number,
  mode: GridSnapMode = GridSnapMode.ALL,
): number {
  const candidates = gridOrientations(gridBearing, mode)
  if (candidates.length === 0) return current // no snap target (e.g. OFF)
  let best = candidates[0]
  let bestDist = Infinity
  for (const candidate of candidates) {
    const dist = angularDistanceDeg(current, candidate)
    if (dist < bestDist) {
      bestDist = dist
      best = candidate
    }
  }
  return best
}
