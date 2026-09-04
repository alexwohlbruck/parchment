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

function labelKey(routeType: number | null | undefined, mode: string | null | undefined, agency: string | null | undefined): string {
  const rt = routeType ?? -1
  switch (rt) {
    case 0: return 'lightRail'
    case 1: return 'subway'
    case 2: return agency && INTERCITY_AGENCIES.test(agency) ? 'intercityRail' : 'commuterRail'
    case 3: return 'bus'
    case 4: return 'ferry'
    case 5: return 'cableCar'
    case 6: return 'aerialTram'
    case 7: return 'funicular'
    case 11: return 'trolleybus'
    case 12: return 'monorail'
  }
  if (rt >= 100 && rt < 200) {
    if (rt === 101 || rt === 102) return 'intercityRail'
    if (rt === 109) return 'commuterRail'
    return 'train'
  }
  if (rt >= 200 && rt < 300) return 'coach'
  if (rt >= 400 && rt < 500) return 'metro'
  if (rt >= 700 && rt < 800) {
    if (rt === 702) return 'expressBus'
    if (rt === 711) return 'shuttleBus'
    if (rt === 712) return 'schoolBus'
    return 'bus'
  }
  if (rt === 800) return 'trolleybus'
  if (rt >= 900 && rt < 1000) return 'tram'
  if (rt >= 1000 && rt < 1100) return 'ferry'
  if (rt >= 1300 && rt < 1400) return 'aerialTram'
  if (rt === 1400) return 'funicular'

  // No usable code — fall back to barrelman's coarse mode word.
  switch (mode) {
    case 'subway': return 'subway'
    case 'rail': return 'commuterRail'
    case 'tram': return 'lightRail'
    case 'bus': return 'bus'
    case 'ferry': return 'ferry'
    case 'trolleybus': return 'trolleybus'
    case 'monorail': return 'monorail'
    case 'funicular': return 'funicular'
    case 'gondola': case 'cable_car': return 'aerialTram'
    default: return 'transit'
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
  return translate(language)(`transit.label.${labelKey(routeType, mode, agency)}`)
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
      case 'subway': return 'subwayStation'
      case 'rail': return 'trainStation'
      case 'tram': return 'lightRailStation'
      case 'monorail': return 'monorailStation'
      case 'ferry': return 'ferryTerminal'
      case 'bus': case 'trolleybus': return 'busStop'
      default: return 'transitStop'
    }
  })()
  return translate(language)(`transit.stop.${key}`)
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
