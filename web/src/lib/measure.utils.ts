import * as turf from '@turf/turf'
import convert from 'convert'
import type { LngLat } from '@/types/map.types'

export type UnitSystem = 'metric' | 'imperial'

const ONE_MILE_METERS = 1609.344
const ONE_KM_METERS = 1000
const ONE_SQ_MI_M2 = ONE_MILE_METERS * ONE_MILE_METERS
const ONE_KM2_M2 = 1_000_000
/** 1 acre in m² (used for imperial area smart units) */
const ONE_ACRE_M2 = 4046.8564224

/** Format a number with locale (decimal/thousand separators). Optional locale; uses default if omitted. */
function formatNumber(
  value: number,
  options: { minFractionDigits?: number; maxFractionDigits?: number },
  locale?: string,
): string {
  const opts: Intl.NumberFormatOptions = {
    minimumFractionDigits: options.minFractionDigits ?? 0,
    maximumFractionDigits: options.maxFractionDigits ?? 2,
  }
  return new Intl.NumberFormat(locale ?? undefined, opts).format(value)
}

/** Format distance with smart units: ft/m until 1 mi, then mi; m until 1 km, then km */
export function formatMeasureDistance(
  meters: number,
  unitSystem: UnitSystem,
  locale?: string,
): string {
  if (meters === 0) return '0'
  if (unitSystem === 'imperial') {
    const mi = convert(meters, 'm').to('mi')
    const ft = convert(meters, 'm').to('ft')
    if (meters >= ONE_MILE_METERS)
      return `${formatNumber(mi, { minFractionDigits: 0, maxFractionDigits: mi >= 10 ? 1 : 2 }, locale)} mi`
    if (ft >= 1)
      return `${formatNumber(ft, { minFractionDigits: 0, maxFractionDigits: ft >= 100 ? 0 : 1 }, locale)} ft`
    return `${formatNumber(meters, { minFractionDigits: 1, maxFractionDigits: 1 }, locale)} m`
  }
  const km = meters / 1000
  if (meters >= ONE_KM_METERS)
    return `${formatNumber(km, { minFractionDigits: 0, maxFractionDigits: km >= 10 ? 1 : 2 }, locale)} km`
  if (meters >= 1)
    return `${formatNumber(meters, { minFractionDigits: 0, maxFractionDigits: meters >= 100 ? 0 : 1 }, locale)} m`
  return `${formatNumber(meters, { minFractionDigits: 2, maxFractionDigits: 2 }, locale)} m`
}

/** Format area with smart units: ft² → ac → mi² (imperial); m² until 1 km² then km² (metric) */
export function formatMeasureArea(
  sqMeters: number,
  unitSystem: UnitSystem,
  locale?: string,
): string {
  if (sqMeters === 0) return '0'
  if (unitSystem === 'imperial') {
    const sqMi = convert(sqMeters, 'm2').to('sq mi')
    const ac = convert(sqMeters, 'm2').to('ac')
    const sqFt = convert(sqMeters, 'm2').to('sq ft')
    if (sqMeters >= ONE_SQ_MI_M2)
      return `${formatNumber(sqMi, { minFractionDigits: 0, maxFractionDigits: sqMi >= 0.1 ? 2 : 4 }, locale)} mi²`
    if (sqMeters >= ONE_ACRE_M2)
      return `${formatNumber(ac, { minFractionDigits: 0, maxFractionDigits: ac >= 10 ? 1 : 2 }, locale)} ac`
    if (sqFt >= 1)
      return `${formatNumber(sqFt, { minFractionDigits: 0, maxFractionDigits: sqFt >= 1000 ? 0 : 1 }, locale)} ft²`
    return `${formatNumber(sqMeters, { minFractionDigits: 2, maxFractionDigits: 2 }, locale)} m²`
  }
  const sqKm = sqMeters / ONE_KM2_M2
  if (sqMeters >= ONE_KM2_M2)
    return `${formatNumber(sqKm, { minFractionDigits: 0, maxFractionDigits: sqKm >= 1 ? 2 : 4 }, locale)} km²`
  if (sqMeters >= 1)
    return `${formatNumber(sqMeters, { minFractionDigits: 0, maxFractionDigits: sqMeters >= 10000 ? 0 : 1 }, locale)} m²`
  return `${formatNumber(sqMeters, { minFractionDigits: 2, maxFractionDigits: 2 }, locale)} m²`
}

// Unit cycling: order for display when user clicks the value
export const DISTANCE_UNITS: Record<UnitSystem, readonly string[]> = {
  imperial: ['ft', 'yd', 'mi'],
  metric: ['m', 'km'],
} as const

export const AREA_UNITS: Record<UnitSystem, readonly string[]> = {
  imperial: ['sq ft', 'ac', 'sq mi'],
  metric: ['m2', 'km2'],
} as const

/** Index into DISTANCE_UNITS that matches the current smart unit for the given distance. */
export function getSmartDistanceUnitIndex(meters: number, unitSystem: UnitSystem): number {
  const units = DISTANCE_UNITS[unitSystem]
  if (unitSystem === 'imperial') return meters >= ONE_MILE_METERS ? 2 : 0 // mi : ft
  return meters >= ONE_KM_METERS ? 1 : 0 // km : m
}

/** Index into AREA_UNITS that matches the current smart unit for the given area. */
export function getSmartAreaUnitIndex(sqMeters: number, unitSystem: UnitSystem): number {
  if (unitSystem === 'imperial') {
    if (sqMeters >= ONE_SQ_MI_M2) return 2 // sq mi
    if (sqMeters >= ONE_ACRE_M2) return 1 // ac
    return 0 // sq ft
  }
  return sqMeters >= ONE_KM2_M2 ? 1 : 0 // km2 : m2
}

/** Format distance in a specific unit (for cycling). */
export function formatMeasureDistanceInUnit(
  meters: number,
  unit: string,
  locale?: string,
): string {
  if (meters === 0) return '0'
  try {
    const val = Number(convert(meters, 'm').to(unit as 'ft' | 'yd' | 'mi' | 'm' | 'km'))
    const labels: Record<string, string> = { ft: 'ft', yd: 'yd', mi: 'mi', m: 'm', km: 'km' }
    const label = labels[unit] ?? unit
    if (unit === 'mi' || unit === 'km')
      return `${formatNumber(val, { minFractionDigits: 0, maxFractionDigits: val >= 10 ? 1 : 2 }, locale)} ${label}`
    if (unit === 'ft' || unit === 'yd')
      return `${formatNumber(val, { minFractionDigits: 0, maxFractionDigits: val >= 100 ? 0 : 1 }, locale)} ${label}`
    return `${formatNumber(val, { minFractionDigits: 0, maxFractionDigits: val >= 100 ? 0 : 1 }, locale)} ${label}`
  } catch {
    return `${formatNumber(meters, { minFractionDigits: 1, maxFractionDigits: 1 }, locale)} m`
  }
}

/** Format area in a specific unit (for cycling). */
export function formatMeasureAreaInUnit(
  sqMeters: number,
  unit: string,
  locale?: string,
): string {
  if (sqMeters === 0) return '0'
  try {
    const val = Number(convert(sqMeters, 'm2').to(unit as 'sq ft' | 'ac' | 'sq mi' | 'm2' | 'km2'))
    const labels: Record<string, string> = {
      'sq ft': 'ft²',
      ac: 'ac',
      'sq mi': 'mi²',
      m2: 'm²',
      km2: 'km²',
    }
    const label = labels[unit] ?? unit
    if (unit === 'sq mi' || unit === 'km2')
      return `${formatNumber(val, { minFractionDigits: 0, maxFractionDigits: val >= 1 ? 2 : 4 }, locale)} ${label}`
    if (unit === 'ac')
      return `${formatNumber(val, { minFractionDigits: 0, maxFractionDigits: val >= 10 ? 1 : 2 }, locale)} ${label}`
    return `${formatNumber(val, { minFractionDigits: 0, maxFractionDigits: val >= 1000 ? 0 : 1 }, locale)} ${label}`
  } catch {
    return `${formatNumber(sqMeters, { minFractionDigits: 2, maxFractionDigits: 2 }, locale)} m²`
  }
}

/** Distance between two points in meters */
export function distanceMeters(a: LngLat, b: LngLat): number {
  return turf.distance(
    [a.lng, a.lat],
    [b.lng, b.lat],
    { units: 'meters' },
  )
}

/** Total path distance in meters */
export function pathLengthMeters(points: LngLat[]): number {
  if (points.length < 2) return 0
  let sum = 0
  for (let i = 0; i < points.length - 1; i++) {
    sum += distanceMeters(points[i], points[i + 1])
  }
  return sum
}

/** Segment distances in meters (between consecutive points) */
export function segmentDistancesMeters(points: LngLat[]): number[] {
  const out: number[] = []
  for (let i = 0; i < points.length - 1; i++) {
    out.push(distanceMeters(points[i], points[i + 1]))
  }
  return out
}

/** Polygon area in square meters (points must form a closed ring) */
export function polygonAreaSquareMeters(points: LngLat[]): number {
  if (points.length < 3) return 0
  const ring = [...points]
  if (ring[0].lng !== ring[ring.length - 1].lng || ring[0].lat !== ring[ring.length - 1].lat) {
    ring.push({ ...ring[0] })
  }
  const turfPoly = {
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'Polygon' as const,
      coordinates: [ring.map(p => [p.lng, p.lat])],
    },
  }
  return turf.area(turfPoly)
}

/** Find nearest point on segment [a, b] to point p, and distance in meters */
export function nearestOnSegment(
  a: LngLat,
  b: LngLat,
  p: LngLat,
): { point: LngLat; distanceMeters: number } {
  const line = turf.lineString([
    [a.lng, a.lat],
    [b.lng, b.lat],
  ])
  const nearest = turf.nearestPointOnLine(line, [p.lng, p.lat])
  const dist = turf.distance(
    [p.lng, p.lat],
    nearest.geometry.coordinates,
    { units: 'meters' },
  )
  return {
    point: { lng: nearest.geometry.coordinates[0], lat: nearest.geometry.coordinates[1] },
    distanceMeters: dist,
  }
}

export type Point2D = { x: number; y: number }

/** Distance between two points in pixels */
export function distancePx(a: Point2D, b: Point2D): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

/** Distance from point to line segment in pixel space; returns distance and t (0–1) for nearest point on segment */
function pointToSegmentDistancePx(
  point: Point2D,
  segStart: Point2D,
  segEnd: Point2D,
): { distancePx: number; t: number } {
  const dx = segEnd.x - segStart.x
  const dy = segEnd.y - segStart.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) {
    return { distancePx: distancePx(point, segStart), t: 0 }
  }
  let t = ((point.x - segStart.x) * dx + (point.y - segStart.y) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  const nearest = { x: segStart.x + t * dx, y: segStart.y + t * dy }
  return { distancePx: distancePx(point, nearest), t }
}

export type MeasureClick = { lngLat: LngLat; point: Point2D }
export type ProjectFn = (lngLat: LngLat) => Point2D | null

/** Default pixel threshold for inserting a midpoint on the line (only when clicking on the line) */
export const INSERT_THRESHOLD_PX = 12

/** Default pixel threshold for closing the loop (only when clicking on the first dot) */
export const CLOSE_LOOP_THRESHOLD_PX = 12

/** Pixel distance below which insert point is considered "on" an existing vertex (reject insert) */
export const VERTEX_NEAR_PX = 8

/** If click is near any segment (within thresholdPx), return { segmentIndex, point }; else null */
export function findSegmentToInsert(
  points: LngLat[],
  click: MeasureClick,
  project: ProjectFn,
  thresholdPx: number = INSERT_THRESHOLD_PX,
): { segmentIndex: number; point: LngLat } | null {
  if (points.length < 2) return null
  let best: { segmentIndex: number; point: LngLat; distancePx: number } | null = null
  for (let i = 0; i < points.length - 1; i++) {
    const startPx = project(points[i])
    const endPx = project(points[i + 1])
    if (!startPx || !endPx) continue
    const { distancePx: d, t } = pointToSegmentDistancePx(click.point, startPx, endPx)
    if (d <= thresholdPx && (best === null || d < best.distancePx)) {
      const a = points[i]
      const b = points[i + 1]
      const point: LngLat = {
        lng: a.lng + t * (b.lng - a.lng),
        lat: a.lat + t * (b.lat - a.lat),
      }
      best = { segmentIndex: i, point, distancePx: d }
    }
  }
  if (!best) return null
  return { segmentIndex: best.segmentIndex, point: best.point }
}

/** Check if click (in pixels) is near the first point (for closing loop) */
export function shouldCloseLoop(
  points: LngLat[],
  click: MeasureClick,
  project: ProjectFn,
  thresholdPx: number = CLOSE_LOOP_THRESHOLD_PX,
): boolean {
  if (points.length < 3) return false
  const firstPx = project(points[0])
  if (!firstPx) return false
  return distancePx(click.point, firstPx) <= thresholdPx
}
