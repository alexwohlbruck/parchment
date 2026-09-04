/**
 * A rider-friendly label for a GTFS route, from its route_type (basic 0-12 or
 * the extended European codes) with the agency as a tiebreaker where one code
 * covers two different things riders distinguish — GTFS files LIRR and Amtrak
 * both as plain 2, but "Commuter rail" and "Intercity rail" are different
 * promises about a trip.
 *
 * Labels resolve to i18n keys under `transit.*` and are stored as complete
 * phrases per language ("Subway line" / "Línea de metro") rather than
 * composed from parts — word order and casing don't survive composition
 * across languages. The agency name is a proper noun and rides alongside
 * unchanged.
 */

import { DEFAULT_LANGUAGE, type Language } from './i18n'
import { translate } from './i18n/translate'

/** Agencies whose plain type-2 routes are intercity, not commuter, service. */
const INTERCITY_AGENCIES = /amtrak|via rail|flixtrain|brightline/i

function labelKey(routeType: number | null | undefined, mode: string | null | undefined, agency: string | null | undefined) {
  const rt = routeType ?? -1
  switch (rt) {
    case 0: return 'transit.label.lightRail'
    case 1: return 'transit.label.subway'
    case 2: return agency && INTERCITY_AGENCIES.test(agency) ? 'transit.label.intercityRail' : 'transit.label.commuterRail'
    case 3: return 'transit.label.bus'
    case 4: return 'transit.label.ferry'
    case 5: return 'transit.label.cableCar'
    case 6: return 'transit.label.aerialTram'
    case 7: return 'transit.label.funicular'
    case 11: return 'transit.label.trolleybus'
    case 12: return 'transit.label.monorail'
  }
  if (rt >= 100 && rt < 200) {
    if (rt === 101 || rt === 102) return 'transit.label.intercityRail'
    if (rt === 109) return 'transit.label.commuterRail'
    return 'transit.label.train'
  }
  if (rt >= 200 && rt < 300) return 'transit.label.coach'
  if (rt >= 400 && rt < 500) return 'transit.label.metro'
  if (rt >= 700 && rt < 800) {
    if (rt === 702) return 'transit.label.expressBus'
    if (rt === 711) return 'transit.label.shuttleBus'
    if (rt === 712) return 'transit.label.schoolBus'
    return 'transit.label.bus'
  }
  if (rt === 800) return 'transit.label.trolleybus'
  if (rt >= 900 && rt < 1000) return 'transit.label.tram'
  if (rt >= 1000 && rt < 1100) return 'transit.label.ferry'
  if (rt >= 1300 && rt < 1400) return 'transit.label.aerialTram'
  if (rt === 1400) return 'transit.label.funicular'

  // No usable code — fall back to barrelman's coarse mode word.
  switch (mode) {
    case 'subway': return 'transit.label.subway'
    case 'rail': return 'transit.label.commuterRail'
    case 'tram': return 'transit.label.lightRail'
    case 'bus': return 'transit.label.bus'
    case 'ferry': return 'transit.label.ferry'
    case 'trolleybus': return 'transit.label.trolleybus'
    case 'monorail': return 'transit.label.monorail'
    case 'funicular': return 'transit.label.funicular'
    case 'gondola': case 'cable_car': return 'transit.label.aerialTram'
    default: return 'transit.label.transit'
  }
}

/**
 * The label alone: "Subway line", "Commuter rail line", "Shuttle bus route".
 */
export function transitModeLabel(
  routeType: number | null | undefined,
  mode: string | null | undefined,
  agency?: string | null,
  language: Language = DEFAULT_LANGUAGE,
): string {
  return translate(language)(labelKey(routeType, mode, agency))
}

/**
 * What to call the place a route stops: rail modes have stations, buses have
 * stops, ferries have terminals.
 */
export function transitStopLabel(
  mode: string | null | undefined,
  language: Language = DEFAULT_LANGUAGE,
): string {
  const key = (() => {
    switch (mode) {
      case 'subway': return 'transit.stop.subwayStation'
      case 'rail': return 'transit.stop.trainStation'
      case 'tram': return 'transit.stop.lightRailStation'
      case 'monorail': return 'transit.stop.monorailStation'
      case 'ferry': return 'transit.stop.ferryTerminal'
      case 'bus': case 'trolleybus': return 'transit.stop.busStop'
      default: return 'transit.stop.transitStop'
    }
  })()
  return translate(language)(key)
}

/**
 * The search-result subtitle: "MTA New York City Transit · Subway line", or
 * just "Commuter rail line" for a feed that names no agency (LIRR's doesn't).
 */
export function transitLineSubtitle(
  routeType: number | null | undefined,
  mode: string | null | undefined,
  agency?: string | null,
  language: Language = DEFAULT_LANGUAGE,
): string {
  const label = transitModeLabel(routeType, mode, agency, language)
  return agency ? `${agency} · ${label}` : label
}
