/**
 * Transit utilities for Transitland integration
 * 
 * This module provides shared constants, types, and utilities for working with
 * transit data from Transitland (GTFS-based data).
 */

/**
 * Transitland route type enumeration (GTFS standard)
 * @see https://gtfs.org/schedule/reference/#routestxt
 */
export enum TransitRouteType {
  TRAM = 0,        // Tram, Streetcar, Light rail
  SUBWAY = 1,      // Subway, Metro
  RAIL = 2,        // Rail, Intercity or long-distance
  BUS = 3,         // Bus
  FERRY = 4,       // Ferry
  CABLE_TRAM = 5,  // Cable tram
  AERIAL_LIFT = 6, // Aerial lift, suspended cable car
  FUNICULAR = 7,   // Funicular
  TROLLEYBUS = 11, // Trolleybus
  MONORAIL = 12,   // Monorail
}

/**
 * Standardized color palette for transit route types
 * These colors are used consistently across map layers and UI components
 */
export const TRANSIT_ROUTE_TYPE_COLORS: Record<TransitRouteType, string> = {
  [TransitRouteType.TRAM]: '#ff9966',
  [TransitRouteType.SUBWAY]: '#ff0000',
  [TransitRouteType.RAIL]: '#666666',
  [TransitRouteType.BUS]: '#1c96d6',
  [TransitRouteType.FERRY]: '#00ACC1',
  [TransitRouteType.CABLE_TRAM]: '#8E24AA',
  [TransitRouteType.AERIAL_LIFT]: '#FF7043',
  [TransitRouteType.FUNICULAR]: '#795548',
  [TransitRouteType.TROLLEYBUS]: '#66BB6A',
  [TransitRouteType.MONORAIL]: '#AB47BC',
}

/**
 * Default Transitland brand color for stops and fallback cases
 */
export const TRANSITLAND_DEFAULT_COLOR = '#007cbf'

/**
 * Get standardized color for a transit route type
 * 
 * @param routeType - GTFS route type
 * @returns Hex color code
 */
export function getRouteTypeColor(routeType: TransitRouteType): string {
  return TRANSIT_ROUTE_TYPE_COLORS[routeType] ?? TRANSITLAND_DEFAULT_COLOR
}

/**
 * Validate if a route color from GTFS is usable
 * Filters out black/empty colors that should use type-based colors instead
 * 
 * @param color - Route color from GTFS data
 * @returns True if the color is valid and usable
 */
export function isValidRouteColor(color: string | undefined): boolean {
  if (!color) return false
  const normalized = color.toLowerCase()
  return normalized !== '' && 
         normalized !== '#000' && 
         normalized !== '#000000' && 
         normalized !== 'black'
}

/**
 * Normalize a route color string to hex format
 * Adds '#' prefix if missing
 * 
 * @param color - Route color string (with or without '#')
 * @returns Normalized hex color code
 */
export function normalizeRouteColor(color: string): string {
  return color.startsWith('#') ? color : `#${color}`
}

/**
 * Get the best color for a transit route
 * Prefers route-specific color if valid, falls back to route type color
 * 
 * @param routeColor - Optional route-specific color from GTFS
 * @param routeType - GTFS route type
 * @returns Hex color code
 */
export function getRouteColor(routeColor: string | undefined, routeType: TransitRouteType): string {
  if (isValidRouteColor(routeColor)) {
    return normalizeRouteColor(routeColor!)
  }
  return getRouteTypeColor(routeType)
}

/**
 * Transitland route information from tile properties
 */
export interface TransitRoute {
  route_id?: string
  route_short_name?: string
  route_long_name?: string
  route_color?: string
  route_type: TransitRouteType
}

/**
 * Transitland stop information from tile properties
 * Based on GTFS stops.txt specification
 */
export interface TransitStop {
  onestop_id: string
  stop_name: string
  stop_id: string
  location_type: number // 0 = stop, 1 = station, 2 = entrance/exit, 3 = generic node, 4 = boarding area
  routes?: TransitRoute[]
}

/**
 * Behavioural role tag attached to transit layer templates via
 * `configuration.metadata.transitRole`. Services derive behaviour (fade on
 * route isolation, line hover/click hit testing, …) from this role instead of
 * matching hardcoded layer IDs — so the IDs can change (e.g. when the data
 * source moves from hosted Transitland tiles to our own generated tiles)
 * without silently breaking click / fade / toggle wiring.
 *
 *   - `routes`   route lines, outlines and route-name labels
 *   - `stops`    stop circles and stop-name labels
 *   - `stations` grouped-station markers (white interchange bars; future)
 *   - `hover`    hover/hitbox utility layers (excluded from isolation fade —
 *                they carry a feature-state opacity expression that breaks if
 *                overridden flat)
 */
export type TransitRole = 'routes' | 'stops' | 'stations' | 'hover'

/** Minimal shape carrying an optional transit role (a layer config or a live
 *  style layer — both expose `metadata`). */
interface TransitRoleCarrier {
  metadata?: { transitRole?: TransitRole; hitMinZoom?: number } | null
  // Layer configs / style layers carry many other keys; allow them so any
  // such object is structurally assignable (a bare string is not).
  [key: string]: unknown
}

/** Read the transit role from a layer configuration or live style layer. */
export function getTransitRole(
  carrier?: TransitRoleCarrier | null,
): TransitRole | undefined {
  return carrier?.metadata?.transitRole ?? undefined
}

/**
 * Minimum zoom at which a transit line layer takes part in hover/click hit
 * testing (`metadata.hitMinZoom`). Layers that fade in on an opacity ramp
 * (buses are fully transparent when zoomed out) are still reported by
 * queryRenderedFeatures, so hit testing gates them until they are actually
 * visible. Defaults to 0 — always hit-testable.
 */
export function getTransitHitMinZoom(
  carrier?: TransitRoleCarrier | null,
): number {
  const value = carrier?.metadata?.hitMinZoom
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * Roles whose layers should fade when a single route is isolated — every
 * transit display role except the `hover` hitbox.
 */
const FADEABLE_TRANSIT_ROLES: ReadonlySet<TransitRole> = new Set<TransitRole>([
  'routes',
  'stops',
  'stations',
])

/** True for transit layers that should fade behind an isolated route. */
export function isFadeableTransitRole(role?: TransitRole): boolean {
  return !!role && FADEABLE_TRANSIT_ROLES.has(role)
}

/**
 * Check if a layer is a transit stop layer (stop circles / stop-name labels).
 * Accepts the layer configuration (or live style layer) and reads its
 * `transitRole` rather than matching a hardcoded ID.
 */
export function isTransitStopLayer(
  carrier?: TransitRoleCarrier | null,
): boolean {
  return getTransitRole(carrier) === 'stops'
}

/**
 * Roles whose LINE layers are hit targets for the transit line hover/click
 * interactions (route detail click-through). Includes the `hover` hitbox —
 * it duplicates the rail geometry at a wider width, giving a more forgiving
 * hit area; candidate dedupe collapses the doubled features.
 */
const TRANSIT_LINE_HIT_ROLES: ReadonlySet<TransitRole> = new Set<TransitRole>([
  'routes',
  'hover',
])

/**
 * True for line layers that participate in transit line hover/click hit
 * testing. Label/bullet symbol layers (also role `routes`) are excluded —
 * they ride the same routes and would only duplicate candidates.
 */
export function isTransitLineHitLayer(
  carrier?: TransitRoleCarrier | null,
): boolean {
  const role = getTransitRole(carrier)
  if (!role || !TRANSIT_LINE_HIT_ROLES.has(role)) return false
  return carrier?.type === 'line'
}

