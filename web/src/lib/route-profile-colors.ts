/**
 * Color mappings for route surface, road type, incline, bike network,
 * stress level, and speed profiles.
 * Shared between the elevation chart and the map route visualization.
 */

import type { TravelMode } from '@/types/directions.types'

export type RouteProfileType =
  | 'surface'
  | 'types'
  | 'incline'
  | 'bike_network'
  | 'stress'
  | 'speed'

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
  { id: 'stress',       label: 'Stress',       modes: ['cycling'] as TravelMode[] },
  { id: 'types',        label: 'Road type',    modes: ['cycling', 'walking', 'driving', 'wheelchair'] as TravelMode[] },
  { id: 'surface',      label: 'Surface',      modes: ['cycling', 'walking', 'driving', 'wheelchair'] as TravelMode[] },
  { id: 'incline',      label: 'Incline',      modes: ['cycling', 'walking', 'wheelchair'] as TravelMode[] },
  { id: 'bike_network', label: 'Bike network', modes: ['cycling'] as TravelMode[] },
  { id: 'speed',        label: 'Speed',        modes: ['cycling', 'walking', 'driving', 'wheelchair'] as TravelMode[] },
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

// ── Road type categories ────────────────────────────────────────────

export const ROAD_TYPE_CATEGORIES: Record<string, ProfileCategory> = {
  cycleway: { label: 'Bike path', color: '#22c55e', caseColor: '#15803d', group: 'bike_infra' },
  mountain_bike: { label: 'Bike path', color: '#22c55e', caseColor: '#15803d', group: 'bike_infra' },
  footway: { label: 'Footpath', color: '#86efac', caseColor: '#4ade80', group: 'ped_infra' },
  sidewalk: { label: 'Sidewalk', color: '#86efac', caseColor: '#4ade80', group: 'ped_infra' },
  steps: { label: 'Steps', color: '#86efac', caseColor: '#4ade80', group: 'ped_infra' },
  track: { label: 'Track', color: '#a3e635', caseColor: '#65a30d', group: 'track' },
  living_street: { label: 'Quiet street', color: '#3b82f6', caseColor: '#1d4ed8', group: 'low_traffic' },
  residential: { label: 'Quiet street', color: '#3b82f6', caseColor: '#1d4ed8', group: 'low_traffic' },
  service_other: { label: 'Quiet street', color: '#3b82f6', caseColor: '#1d4ed8', group: 'low_traffic' },
  unclassified: { label: 'Street', color: '#93c5fd', caseColor: '#3b82f6', group: 'moderate' },
  tertiary: { label: 'Street', color: '#eab308', caseColor: '#a16207', group: 'moderate' },
  secondary: { label: 'Busy road', color: '#f97316', caseColor: '#c2410c', group: 'busy' },
  primary: { label: 'Busy road', color: '#ef4444', caseColor: '#b91c1c', group: 'busy' },
  trunk: { label: 'Highway', color: '#dc2626', caseColor: '#991b1b', group: 'highway' },
  motorway: { label: 'Highway', color: '#991b1b', caseColor: '#7f1d1d', group: 'highway' },
  ferry: { label: 'Ferry', color: '#06b6d4', caseColor: '#0891b2', group: 'ferry' },
  road: { label: 'Road', color: '#9ca3af', caseColor: '#6b7280', group: 'unknown' },
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

// ── Bike network categories ─────────────────────────────────────────

export const BIKE_NETWORK_CATEGORIES: Record<string, ProfileCategory> = {
  international: { label: 'International', color: '#7c3aed', caseColor: '#5b21b6', group: 'international' },
  national:      { label: 'National',      color: '#2563eb', caseColor: '#1d4ed8', group: 'national' },
  regional:      { label: 'Regional',      color: '#0891b2', caseColor: '#0e7490', group: 'regional' },
  local:         { label: 'Local',         color: '#22c55e', caseColor: '#15803d', group: 'local' },
  other:         { label: 'None',          color: '#9ca3af', caseColor: '#6b7280', group: 'none' },
  unknown:       { label: 'None',          color: '#9ca3af', caseColor: '#6b7280', group: 'none' },
}

// ── Stress level categories ─────────────────────────────────────────
// Computed from road_class + bike_network + surface + getOffBike

export const STRESS_CATEGORIES: Record<string, ProfileCategory> = {
  very_low:  { label: 'Very low',  color: '#22c55e', caseColor: '#15803d', group: 'very_low' },
  low:       { label: 'Low',       color: '#86efac', caseColor: '#4ade80', group: 'low' },
  moderate:  { label: 'Moderate',  color: '#eab308', caseColor: '#a16207', group: 'moderate' },
  high:      { label: 'High',      color: '#f97316', caseColor: '#c2410c', group: 'high' },
  very_high: { label: 'Very high', color: '#ef4444', caseColor: '#b91c1c', group: 'very_high' },
  unknown:   { label: 'Unknown',   color: '#9ca3af', caseColor: '#6b7280', group: 'unknown' },
}

// ── Speed categories ────────────────────────────────────────────────

export const SPEED_CATEGORIES: Record<string, ProfileCategory> = {
  very_slow: { label: '< 10 km/h',   color: '#ef4444', caseColor: '#b91c1c', group: 'very_slow' },
  slow:      { label: '10–15 km/h',   color: '#f97316', caseColor: '#c2410c', group: 'slow' },
  moderate:  { label: '15–20 km/h',   color: '#eab308', caseColor: '#a16207', group: 'moderate' },
  fast:      { label: '20–25 km/h',   color: '#22c55e', caseColor: '#15803d', group: 'fast' },
  very_fast: { label: '> 25 km/h',    color: '#3b82f6', caseColor: '#1d4ed8', group: 'very_fast' },
  unknown:   { label: 'Unknown',      color: '#9ca3af', caseColor: '#6b7280', group: 'unknown' },
}

// ── Category map by profile type ────────────────────────────────────

export const CATEGORY_MAPS: Record<RouteProfileType, Record<string, ProfileCategory>> = {
  surface: SURFACE_CATEGORIES,
  types: ROAD_TYPE_CATEGORIES,
  incline: INCLINE_CATEGORIES,
  bike_network: BIKE_NETWORK_CATEGORIES,
  stress: STRESS_CATEGORIES,
  speed: SPEED_CATEGORIES,
}

// ── Lookup helpers ──────────────────────────────────────────────────

export function getSurfaceCategory(surface: string): ProfileCategory {
  return SURFACE_CATEGORIES[surface] || SURFACE_CATEGORIES.unknown
}

export function getRoadTypeCategory(use: string, roadClass: string): ProfileCategory {
  return ROAD_TYPE_CATEGORIES[use] || ROAD_TYPE_CATEGORIES[roadClass] || ROAD_TYPE_CATEGORIES.unknown
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

/** Look up bike network tier */
export function getBikeNetworkCategory(bikeNetwork: string | undefined): ProfileCategory {
  if (!bikeNetwork) return BIKE_NETWORK_CATEGORIES.unknown
  return BIKE_NETWORK_CATEGORIES[bikeNetwork] || BIKE_NETWORK_CATEGORIES.unknown
}

/**
 * Compute a stress level from available edge attributes.
 * Heuristic scoring (0-100), then bucketed.
 */
export function getStressCategory(
  use: string | undefined,
  roadClass: string | undefined,
  bikeNetwork: string | undefined,
  surface: string | undefined,
  getOffBike: boolean | undefined,
): ProfileCategory {
  if (getOffBike) return STRESS_CATEGORIES.very_high

  let score = 50 // neutral baseline

  // Road type is the biggest factor
  const rc = (use && use !== 'road') ? use : (roadClass || '')
  switch (rc) {
    case 'cycleway': score -= 35; break
    case 'footway': case 'steps': score -= 20; break
    case 'track': score -= 15; break
    case 'living_street': score -= 25; break
    case 'residential': case 'service_other': score -= 15; break
    case 'unclassified': score -= 5; break
    case 'tertiary': score += 5; break
    case 'secondary': score += 15; break
    case 'primary': score += 25; break
    case 'trunk': case 'motorway': score += 40; break
  }

  // Bike network membership reduces stress
  switch (bikeNetwork) {
    case 'international': case 'national': score -= 15; break
    case 'regional': score -= 10; break
    case 'local': score -= 5; break
  }

  // Poor surfaces increase stress
  const surfaceCat = getSurfaceCategory(surface || 'unknown')
  switch (surfaceCat.group) {
    case 'trail': score += 10; break
    case 'unpaved': score += 5; break
  }

  // Clamp and bucket
  score = Math.max(0, Math.min(100, score))
  if (score <= 15) return STRESS_CATEGORIES.very_low
  if (score <= 35) return STRESS_CATEGORIES.low
  if (score <= 55) return STRESS_CATEGORIES.moderate
  if (score <= 75) return STRESS_CATEGORIES.high
  return STRESS_CATEGORIES.very_high
}

/** Classify routing speed (km/h) into a bucket */
export function getSpeedCategory(averageSpeed: number | undefined): ProfileCategory {
  if (averageSpeed == null) return SPEED_CATEGORIES.unknown
  if (averageSpeed < 10) return SPEED_CATEGORIES.very_slow
  if (averageSpeed < 15) return SPEED_CATEGORIES.slow
  if (averageSpeed < 20) return SPEED_CATEGORIES.moderate
  if (averageSpeed < 25) return SPEED_CATEGORIES.fast
  return SPEED_CATEGORIES.very_fast
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
    case 'types':
      return getRoadTypeCategory(edge.use || 'road', edge.roadClass || 'unknown')
    case 'incline':
      return getInclineCategory(edge.averageSlope)
    case 'bike_network':
      return getBikeNetworkCategory(edge.bikeNetwork)
    case 'stress':
      return getStressCategory(edge.use, edge.roadClass, edge.bikeNetwork, edge.surface, edge.getOffBike)
    case 'speed':
      return getSpeedCategory(edge.averageSpeed)
    default:
      return { label: 'Unknown', color: '#9ca3af', caseColor: '#6b7280', group: 'unknown' }
  }
}

/**
 * Check whether a category resolves to the "unknown" bucket
 */
export function isUnknownEdge(profile: RouteProfileType, surface: string, use: string, roadClass: string): boolean {
  if (profile === 'surface') {
    const cat = SURFACE_CATEGORIES[surface]
    return !cat || cat.group === 'unknown'
  }
  if (profile === 'types') {
    const cat = ROAD_TYPE_CATEGORIES[use] || ROAD_TYPE_CATEGORIES[roadClass]
    return !cat || cat.group === 'unknown'
  }
  // For other profiles, "unknown" is determined per-edge via getEdgeCategory
  return false
}

/**
 * Get color for an edge segment based on the active profile.
 * An optional `fallback` can be supplied; if the edge is "unknown" the fallback is returned instead.
 *
 * Overload 1 (legacy): pass individual fields — works for surface/types profiles.
 * Overload 2: pass the full RouteEdgeSegment — works for ALL profiles.
 */
export function getEdgeColor(
  profile: RouteProfileType,
  surfaceOrEdge: string | RouteEdgeSegment,
  use?: string,
  roadClass?: string,
  fallback?: string,
): string {
  // Full-edge overload
  if (typeof surfaceOrEdge === 'object') {
    const edge = surfaceOrEdge
    const fb = use as string | undefined // 2nd arg becomes fallback in this overload
    const cat = getEdgeCategory(profile, edge)
    if (fb && cat.group === 'unknown') return fb
    return cat.color
  }
  // Legacy string overload (surface/types only)
  const surface = surfaceOrEdge
  if (fallback && isUnknownEdge(profile, surface, use ?? '', roadClass ?? '')) return fallback
  if (profile === 'surface') {
    return getSurfaceCategory(surface).color
  }
  return getRoadTypeCategory(use ?? '', roadClass ?? '').color
}

/**
 * Get case (border) color for an edge segment based on the active profile.
 * An optional `fallback` can be supplied; if the edge is "unknown" the fallback is returned instead.
 *
 * Overload 1 (legacy): pass individual fields — works for surface/types profiles.
 * Overload 2: pass the full RouteEdgeSegment — works for ALL profiles.
 */
export function getEdgeCaseColor(
  profile: RouteProfileType,
  surfaceOrEdge: string | RouteEdgeSegment,
  use?: string,
  roadClass?: string,
  fallback?: string,
): string {
  // Full-edge overload
  if (typeof surfaceOrEdge === 'object') {
    const edge = surfaceOrEdge
    const fb = use as string | undefined
    const cat = getEdgeCategory(profile, edge)
    if (fb && cat.group === 'unknown') return fb
    return cat.caseColor
  }
  // Legacy string overload (surface/types only)
  const surface = surfaceOrEdge
  if (fallback && isUnknownEdge(profile, surface, use ?? '', roadClass ?? '')) return fallback
  if (profile === 'surface') {
    return getSurfaceCategory(surface).caseColor
  }
  return getRoadTypeCategory(use ?? '', roadClass ?? '').caseColor
}
