/**
 * A rider-friendly label for a GTFS route, from its route_type (basic 0-12 or
 * the extended European codes) with the agency as a tiebreaker where one code
 * covers two different things riders distinguish — GTFS files LIRR and Amtrak
 * both as plain 2, but "Commuter rail" and "Intercity rail" are different
 * promises about a trip.
 */

/** Agencies whose plain type-2 routes are intercity, not commuter, service. */
const INTERCITY_AGENCIES = /amtrak|via rail|flixtrain|brightline/i

function baseLabel(routeType: number | null | undefined, mode: string | null | undefined, agency: string | null | undefined): string {
  const rt = routeType ?? -1
  switch (rt) {
    case 0: return 'Light rail'
    case 1: return 'Subway'
    case 2: return agency && INTERCITY_AGENCIES.test(agency) ? 'Intercity rail' : 'Commuter rail'
    case 3: return 'Bus'
    case 4: return 'Ferry'
    case 5: return 'Cable car'
    case 6: return 'Aerial tram'
    case 7: return 'Funicular'
    case 11: return 'Trolleybus'
    case 12: return 'Monorail'
  }
  if (rt >= 100 && rt < 200) {
    if (rt === 101 || rt === 102) return 'Intercity rail'
    if (rt === 109) return 'Commuter rail'
    return 'Train'
  }
  if (rt >= 200 && rt < 300) return 'Coach'
  if (rt >= 400 && rt < 500) return 'Metro'
  if (rt >= 700 && rt < 800) {
    if (rt === 702) return 'Express bus'
    if (rt === 711) return 'Shuttle bus'
    if (rt === 712) return 'School bus'
    return 'Bus'
  }
  if (rt === 800) return 'Trolleybus'
  if (rt >= 900 && rt < 1000) return 'Tram'
  if (rt >= 1000 && rt < 1100) return 'Ferry'
  if (rt >= 1300 && rt < 1400) return 'Aerial tram'
  if (rt === 1400) return 'Funicular'

  // No usable code — fall back to barrelman's coarse mode word.
  switch (mode) {
    case 'subway': return 'Subway'
    case 'rail': return 'Commuter rail'
    case 'tram': return 'Light rail'
    case 'bus': return 'Bus'
    case 'ferry': return 'Ferry'
    case 'trolleybus': return 'Trolleybus'
    case 'monorail': return 'Monorail'
    case 'funicular': return 'Funicular'
    case 'gondola': case 'cable_car': return 'Aerial tram'
    default: return 'Transit'
  }
}

/** Buses run routes; everything on rails or water runs lines. */
function noun(label: string): string {
  return /bus|coach/i.test(label) ? 'route' : 'line'
}

/**
 * The label alone: "Subway line", "Commuter rail line", "Shuttle bus route".
 */
export function transitModeLabel(
  routeType: number | null | undefined,
  mode: string | null | undefined,
  agency?: string | null,
): string {
  const label = baseLabel(routeType, mode, agency)
  return `${label} ${noun(label)}`
}

/**
 * What to call the place a route stops: rail modes have stations, buses have
 * stops, ferries have terminals.
 */
export function transitStopLabel(mode: string | null | undefined): string {
  switch (mode) {
    case 'subway': return 'Subway station'
    case 'rail': return 'Train station'
    case 'tram': return 'Light rail station'
    case 'monorail': return 'Monorail station'
    case 'ferry': return 'Ferry terminal'
    case 'bus': case 'trolleybus': return 'Bus stop'
    default: return 'Transit stop'
  }
}

/**
 * The search-result subtitle: "MTA New York City Transit · Subway line", or
 * just "Commuter rail line" for a feed that names no agency (LIRR's doesn't).
 */
export function transitLineSubtitle(
  routeType: number | null | undefined,
  mode: string | null | undefined,
  agency?: string | null,
): string {
  const label = transitModeLabel(routeType, mode, agency)
  return agency ? `${agency} · ${label}` : label
}
