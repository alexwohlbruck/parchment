import { TransitRouteType } from '@/types/transit.types'

/** Shared across map layers and UI so a route reads the same in both. */
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

export const TRANSITLAND_DEFAULT_COLOR = '#007cbf'

export function getRouteTypeColor(routeType: TransitRouteType): string {
  return TRANSIT_ROUTE_TYPE_COLORS[routeType] ?? TRANSITLAND_DEFAULT_COLOR
}

/** GTFS feeds routinely ship black or empty as "no colour set". */
export function isValidRouteColor(color: string | undefined): boolean {
  if (!color) return false
  const normalized = color.toLowerCase()
  return (
    normalized !== '' &&
    normalized !== '#000' &&
    normalized !== '#000000' &&
    normalized !== 'black'
  )
}

export function normalizeRouteColor(color: string): string {
  return color.startsWith('#') ? color : `#${color}`
}

export function getRouteColor(
  routeColor: string | undefined,
  routeType: TransitRouteType,
): string {
  if (isValidRouteColor(routeColor)) {
    return normalizeRouteColor(routeColor!)
  }
  return getRouteTypeColor(routeType)
}
