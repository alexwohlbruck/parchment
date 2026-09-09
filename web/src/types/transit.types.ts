// Import the types from the server
import type {
  ServiceAlert,
  ServiceAlertsResponse,
  AlertActivePeriod,
  AlertSeverity,
  InformedEntity,
} from '@server/types/transit.types'

// Re-export for use in client code
export type {
  ServiceAlert,
  ServiceAlertsResponse,
  AlertActivePeriod,
  AlertSeverity,
  InformedEntity,
}

import type { TransitVehiclePosition } from '@/types/multimodal.types'
import type { TransitDeparture } from '@server/types/place.types'

/** Another line available at a stop on this route. `station` calls there;
 *  `transfer` is reached from it without leaving the paid area. */
export interface StopTransferRoute {
  routeId: string
  routeShortName: string | null
  routeLongName: string | null
  routeType: number | null
  routeColor: string | null
  routeTextColor: string | null
  agencyName: string | null
  via: 'station' | 'transfer'
}

export interface RouteDetailStop {
  stopId: string
  stopName: string
  /** GTFS parent station, when the stop is a platform of one. What GTFS-RT
   *  alerts name — they inform stations, not platforms. */
  parentStation?: string
  lat: number
  lng: number
  distanceAlongRoute: number
  /** Lines other than this one available here. Absent from older instances. */
  routes?: StopTransferRoute[]
}

export interface RouteDetail {
  feedId: string
  routeId: string
  routeShortName: string | null
  routeLongName: string | null
  routeColor: string | null
  routeTextColor: string | null
  routeType: number | null
  agencyName: string | null
  stops: RouteDetailStop[]
  coordinates: [number, number][] | null
  relatedRouteIds: string[]
}

export interface DepartureContext {
  originStopName: string
  headsign: string
  departures: TransitDeparture[]
}

/** A vehicle projected onto the route's stop list. */
export interface VehicleOnRoute {
  vehicleId: string
  vehicle: TransitVehiclePosition
  /** Index of the stop the vehicle is approaching (or just passed). */
  nearestStopIndex: number
  /** 0-1 fraction between nearestStopIndex-1 and nearestStopIndex. */
  fractionBetweenStops: number
  /** Distance along route in meters. */
  distanceAlongRoute: number
  /** 0-1 position along the entire route (for timeline placement). */
  routeFraction: number
  /** True if the vehicle is moving in the original stop-list direction (start→end). */
  isForwardDirection: boolean
}

/** GTFS route types. @see https://gtfs.org/schedule/reference/#routestxt */
export enum TransitRouteType {
  TRAM = 0,
  SUBWAY = 1,
  RAIL = 2,
  BUS = 3,
  FERRY = 4,
  CABLE_TRAM = 5,
  AERIAL_LIFT = 6,
  FUNICULAR = 7,
  TROLLEYBUS = 11,
  MONORAIL = 12,
}

/** Transitland route properties as they arrive on a tile feature. */
export interface TransitRoute {
  route_id?: string
  route_short_name?: string
  route_long_name?: string
  route_color?: string
  route_type: TransitRouteType
}

export interface TransitStop {
  onestop_id: string
  stop_name: string
  stop_id: string
  /** GTFS location_type: 0 stop, 1 station, 2 entrance, 3 node, 4 boarding area. */
  location_type: number
  routes?: TransitRoute[]
}
