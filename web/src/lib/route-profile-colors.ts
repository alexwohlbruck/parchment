/**
 * Color mappings for route surface, incline, and bike-friendliness profiles.
 * Shared between the elevation chart and the map route visualization.
 *
 * Each profile is driven by a single GraphHopper path-detail field:
 *   - surface:  `surface` encoded value
 *   - incline:  `average_slope` encoded value
 *   - stress:   `bike_priority` encoded value (cycling only)
 */

import type { TravelMode } from '@/types/directions.types'

export type RouteProfileType =
  | 'surface'
  | 'incline'
  | 'stress'

export interface ProfileCategory {
  label: string
  color: string
  caseColor: string // darker variant for map outline / case layer
  group: string
}

/** Metadata for each profile tab */
export interface ProfileTabDef {
  id: RouteProfileType
  label: string
  /** Which travel modes show this tab */
  modes: TravelMode[]
}

/**
 * Ordered list of profile tabs. The UI renders only tabs whose `modes`
 * include the current travel mode.
 */
export const PROFILE_TABS: ProfileTabDef[] = [
  { id: 'stress',  label: 'Bike friendly', modes: ['cycling'] as TravelMode[] },
  { id: 'surface', label: 'Surface',       modes: ['cycling', 'walking', 'driving', 'wheelchair'] as TravelMode[] },
  { id: 'incline', label: 'Incline',       modes: ['cycling', 'walking', 'wheelchair'] as TravelMode[] },
]

// ── Surface categories ──────────────────────────────────────────────

export const SURFACE_CATEGORIES: Record<string, ProfileCategory> = {
  paved_smooth: { label: 'Paved', color: '#22c55e', caseColor: '#15803d', group: 'paved' },
  paved: { label: 'Paved', color: '#22c55e', caseColor: '#15803d', group: 'paved' },
  paved_rough: { label: 'Rough paved', color: '#eab308', caseColor: '#a16207', group: 'rough' },
  compacted: { label: 'Compacted', color: '#eab308', caseColor: '#a16207', group: 'rough' },
  gravel: { label: 'Gravel', color: '#f97316', caseColor: '#c2410c', group: 'unpaved' },
  dirt: { label: 'Dirt', color: '#f97316', caseColor: '#c2410c', group: 'unpaved' },
  path: { label: 'Path', color: '#ef4444', caseColor: '#b91c1c', group: 'trail' },
  impassable: { label: 'Impassable', color: '#ef4444', caseColor: '#b91c1c', group: 'trail' },
  unknown: { label: 'Unknown', color: '#9ca3af', caseColor: '#6b7280', group: 'unknown' },
}

// ── Incline categories ──────────────────────────────────────────────

export const INCLINE_CATEGORIES: Record<string, ProfileCategory> = {
  steep_up:     { label: 'Steep uphill',     color: '#dc2626', caseColor: '#991b1b', group: 'steep_up' },
  moderate_up:  { label: 'Uphill',           color: '#f97316', caseColor: '#c2410c', group: 'moderate_up' },
  gentle_up:    { label: 'Gentle uphill',    color: '#eab308', caseColor: '#a16207', group: 'gentle_up' },
  flat:         { label: 'Flat',             color: '#86efac', caseColor: '#4ade80', group: 'flat' },
  gentle_down:  { label: 'Gentle downhill',  color: '#22c55e', caseColor: '#15803d', group: 'gentle_down' },
  moderate_down:{ label: 'Downhill',         color: '#16a34a', caseColor: '#15803d', group: 'moderate_down' },
  steep_down:   { label: 'Steep downhill',   color: '#166534', caseColor: '#14532d', group: 'steep_down' },
  unknown:      { label: 'Unknown',          color: '#9ca3af', caseColor: '#6b7280', group: 'unknown' },
}

// ── Bike-friendliness categories ────────────────────────────────────
// Driven by GraphHopper's `bike_priority` encoded value (0–1, higher =
// friendlier). We keep the STRESS_CATEGORIES name + type-id 'stress'
// internally so existing map/layer code doesn't need to rename, but the
// semantics are flipped: "very_low" friendliness = red (worst),
// "very_high" = green (best).

export const STRESS_CATEGORIES: Record<string, ProfileCategory> = {
  very_high: { label: 'Very friendly', color: '#22c55e', caseColor: '#15803d', group: 'very_high' },
  high:      { label: 'Friendly',      color: '#86efac', caseColor: '#4ade80', group: 'high' },
  moderate:  { label: 'Moderate',      color: '#eab308', caseColor: '#a16207', group: 'moderate' },
  low:       { label: 'Low',           color: '#f97316', caseColor: '#c2410c', group: 'low' },
  very_low:  { label: 'Unfriendly',    color: '#ef4444', caseColor: '#b91c1c', group: 'very_low' },
  unknown:   { label: 'Unknown',       color: '#9ca3af', caseColor: '#6b7280', group: 'unknown' },
}

// ── Category map by profile type ────────────────────────────────────

export const CATEGORY_MAPS: Record<RouteProfileType, Record<string, ProfileCategory>> = {
  surface: SURFACE_CATEGORIES,
  incline: INCLINE_CATEGORIES,
  stress: STRESS_CATEGORIES,
}

// ── Lookup helpers ──────────────────────────────────────────────────

export function getSurfaceCategory(surface: string): ProfileCategory {
  return SURFACE_CATEGORIES[surface] || SURFACE_CATEGORIES.unknown
}

/** Classify an average slope (%) into an incline bucket */
export function getInclineCategory(averageSlope: number | undefined): ProfileCategory {
  if (averageSlope == null) return INCLINE_CATEGORIES.unknown
  if (averageSlope >= 8) return INCLINE_CATEGORIES.steep_up
  if (averageSlope >= 4) return INCLINE_CATEGORIES.moderate_up
  if (averageSlope >= 1) return INCLINE_CATEGORIES.gentle_up
  if (averageSlope > -1) return INCLINE_CATEGORIES.flat
  if (averageSlope > -4) return INCLINE_CATEGORIES.gentle_down
  if (averageSlope > -8) return INCLINE_CATEGORIES.moderate_down
  return INCLINE_CATEGORIES.steep_down
}

/**
 * Classify a bike-friendliness level from GraphHopper's `bike_priority`
 * encoded value (higher = friendlier; empirically ~0.4–1.3).
 *
 * Observed GH values for the `bike` profile:
 *   cycleway                  1.2–1.3
 *   residential / quiet road  1.1–1.2
 *   tertiary                  1.0–1.1
 *   footway (dismount)        0.9
 *   secondary                 0.7–0.9
 *   primary / trunk           ≤ 0.6
 *
 * `get_off_bike` edges are forced to the worst bucket regardless of the
 * raw bike_priority value, since they require dismounting.
 */
export function getStressCategory(
  bikePriority: number | undefined,
  getOffBike: boolean | undefined,
): ProfileCategory {
  if (getOffBike) return STRESS_CATEGORIES.very_low
  if (bikePriority == null) return STRESS_CATEGORIES.unknown
  if (bikePriority >= 1.2) return STRESS_CATEGORIES.very_high
  if (bikePriority >= 1.0) return STRESS_CATEGORIES.high
  if (bikePriority >= 0.9) return STRESS_CATEGORIES.moderate
  if (bikePriority >= 0.7) return STRESS_CATEGORIES.low
  return STRESS_CATEGORIES.very_low
}

// ── Generic edge → category resolver ────────────────────────────────

import type { RouteEdgeSegment } from '@/types/directions.types'

/** Resolve the ProfileCategory for an edge segment given the active profile */
export function getEdgeCategory(
  profile: RouteProfileType,
  edge: RouteEdgeSegment,
): ProfileCategory {
  switch (profile) {
    case 'surface':
      return getSurfaceCategory(edge.surface || 'unknown')
    case 'incline':
      return getInclineCategory(edge.averageSlope)
    case 'stress':
      return getStressCategory(edge.bikePriority, edge.getOffBike)
    default:
      return { label: 'Unknown', color: '#9ca3af', caseColor: '#6b7280', group: 'unknown' }
  }
}

/**
 * Check whether a category resolves to the "unknown" bucket (surface profile only).
 * For other profiles, "unknown" is determined per-edge via getEdgeCategory.
 */
export function isUnknownEdge(profile: RouteProfileType, surface: string): boolean {
  if (profile === 'surface') {
    const cat = SURFACE_CATEGORIES[surface]
    return !cat || cat.group === 'unknown'
  }
  return false
}

/**
 * Get color for an edge segment based on the active profile.
 * An optional `fallback` can be supplied; if the edge is "unknown" the fallback is returned instead.
 *
 * Overload 1 (legacy): pass `surface` string — works for the surface profile only.
 * Overload 2: pass the full RouteEdgeSegment — works for ALL profiles.
 */
export function getEdgeColor(
  profile: RouteProfileType,
  surfaceOrEdge: string | RouteEdgeSegment,
  fallback?: string,
): string {
  // Full-edge overload
  if (typeof surfaceOrEdge === 'object') {
    const edge = surfaceOrEdge
    const cat = getEdgeCategory(profile, edge)
    if (fallback && cat.group === 'unknown') return fallback
    return cat.color
  }
  // Legacy string overload (surface only)
  const surface = surfaceOrEdge
  if (fallback && isUnknownEdge(profile, surface)) return fallback
  return getSurfaceCategory(surface).color
}

/**
 * Get case (border) color for an edge segment based on the active profile.
 * An optional `fallback` can be supplied; if the edge is "unknown" the fallback is returned instead.
 *
 * Overload 1 (legacy): pass `surface` string — works for the surface profile only.
 * Overload 2: pass the full RouteEdgeSegment — works for ALL profiles.
 */
export function getEdgeCaseColor(
  profile: RouteProfileType,
  surfaceOrEdge: string | RouteEdgeSegment,
  fallback?: string,
): string {
  // Full-edge overload
  if (typeof surfaceOrEdge === 'object') {
    const edge = surfaceOrEdge
    const cat = getEdgeCategory(profile, edge)
    if (fallback && cat.group === 'unknown') return fallback
    return cat.caseColor
  }
  // Legacy string overload (surface only)
  const surface = surfaceOrEdge
  if (fallback && isUnknownEdge(profile, surface)) return fallback
  return getSurfaceCategory(surface).caseColor
}
