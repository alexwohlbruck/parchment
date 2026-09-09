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
 * Transitland layer IDs for event handling
 */
export const TRANSITLAND_LAYER_IDS = {
  STOPS: 'transitland-stops',
  STOPS_LABELS: 'transitland-stops-labels',
  ROUTES: 'transitland',
  ROUTES_CASE: 'transitland-case',
  ROUTE_ACTIVE: 'transitland-route-active',
} as const

/**
 * Check if a layer ID is a transit stop layer (for click handling)
 */
export function isTransitStopLayer(layerId?: string): boolean {
  if (!layerId) return false
  return (
    layerId === TRANSITLAND_LAYER_IDS.STOPS ||
    layerId === TRANSITLAND_LAYER_IDS.STOPS_LABELS
  )
}

