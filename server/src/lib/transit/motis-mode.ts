import type { TransitRouteType } from '../../types/trip.types'

/** MOTIS splits GTFS route types finer than the app draws them. */
const ROUTE_TYPE_BY_MOTIS_MODE: Record<string, TransitRouteType> = {
  TRAM: 'tram',
  SUBWAY: 'subway',
  METRO: 'subway',
  RAIL: 'rail',
  SUBURBAN: 'rail',
  REGIONAL_RAIL: 'rail',
  REGIONAL_FAST_RAIL: 'rail',
  HIGHSPEED_RAIL: 'rail',
  LONG_DISTANCE: 'rail',
  NIGHT_RAIL: 'rail',
  BUS: 'bus',
  COACH: 'bus',
  FERRY: 'ferry',
  CABLE_CAR: 'cable_tram',
  AERIAL_LIFT: 'aerial_lift',
  GONDOLA: 'aerial_lift',
  FUNICULAR: 'funicular',
}

export function routeTypeForMotisMode(mode: string): TransitRouteType {
  return ROUTE_TYPE_BY_MOTIS_MODE[mode] ?? 'bus'
}
