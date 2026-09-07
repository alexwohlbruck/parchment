import type { ServiceAlert } from '@/types/transit.types'

/**
 * What the agency's alerts say about which stops a line is serving right now.
 *
 * The departure boards that normally answer this question only know the
 * timetable plus whatever realtime the router ingested — and a planned
 * reroute often never reaches them. When the 4 ran local down Eastern Pkwy
 * for a parade, the boards at Grand Army Plaza went on answering "2, 3":
 * the local stops were nowhere in the 4's schedule for that hour, so the
 * path drawn from boards alone showed the express run the train wasn't
 * making.
 *
 * The alerts feed is where the agency actually says this, and it says it
 * machine-readably: the "runs local" alert is `MODIFIED_SERVICE` with an
 * informed entity per (route, stop) it now serves, and the "skips X" alert
 * names the (route, stop) pairs it doesn't. Those pairs refine the board's
 * answer — they don't replace it, because most alerts name no stops at all.
 *
 * Only an entity naming BOTH this route and a stop counts. A route-wide
 * alert ("delays on the 4") says nothing about any particular stop, and a
 * stop-only entity belongs to every line at the station — reading either as
 * a path change would redraw the line on evidence about something else.
 */
export interface AlertServiceOverrides {
  /** Stops the agency says the line IS serving — stations or platforms,
   *  as the feed named them. */
  serves: Set<string>
  /** Stops it says the line is NOT serving. Wins over `serves`: the MTA
   *  publishes "runs local" naming every local stop and a separate "skips
   *  X" for the one it still passes, and the skip is the later word. */
  skips: Set<string>
}

/** Effects that assert the named stops ARE being served. */
const SERVE_EFFECTS = new Set(['MODIFIED_SERVICE', 'ADDITIONAL_SERVICE'])

/** Effects that assert they are NOT. `DETOUR` is how the MTA (and most bus
 *  feeds) mark stops a rerouted vehicle passes without calling. */
const SKIP_EFFECTS = new Set(['NO_SERVICE', 'DETOUR'])

/**
 * Fold a route's in-effect alerts into per-stop overrides.
 *
 * Callers pass alerts already filtered to the ones active now (the alerts
 * composable's `inEffect`) — the active-period arithmetic lives there, once.
 */
export function alertServiceOverrides(
  alerts: ServiceAlert[],
  routeId: string,
): AlertServiceOverrides {
  const serves = new Set<string>()
  const skips = new Set<string>()

  for (const alert of alerts) {
    const bucket = SERVE_EFFECTS.has(alert.effect)
      ? serves
      : SKIP_EFFECTS.has(alert.effect)
        ? skips
        : null
    if (!bucket) continue

    for (const entity of alert.informedEntities ?? []) {
      if (entity.routeId === routeId && entity.stopId) bucket.add(entity.stopId)
    }
  }

  return { serves, skips }
}
