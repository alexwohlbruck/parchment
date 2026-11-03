/**
 * MOTIS names a route that has no GTFS short name by the trip's short name, so
 * an LIRR leg arrives as "1368" rather than "Port Washington Branch".
 */

import type { TransitDetails } from '../../types/trip.types'
import type { StopRouteResult } from '../../types/integration.types'

export type GtfsRouteNames = Pick<StopRouteResult, 'routeShortName' | 'routeLongName'>

/** Name the leg by its route; a trip number moves to the trip. */
export function nameLegByRoute(td: TransitDetails, route: GtfsRouteNames): void {
  if (route.routeShortName) return
  const lineName = td.route.longName || route.routeLongName
  if (!lineName) return
  const motisName = td.route.shortName
  td.route.shortName = undefined
  td.route.longName = lineName
  td.shortName = lineName
  if (motisName && motisName !== lineName) td.trip.shortName = motisName
}
