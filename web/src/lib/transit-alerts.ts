/**
 * Service alert helpers.
 *
 * Turning an agency's GTFS-RT alert into something a rider can read at a
 * glance: how bad is it, what word describes it, and which of several alerts
 * on the same line deserves the badge.
 *
 * Ids that reach us from a planned trip are MOTIS ids — feed-prefixed, like
 * `mta-nyct-subway_B48` — while the ids inside an alert are feed-local. The
 * split helpers here are what let a trip leg ask about its own route.
 */

import type { ServiceAlert } from '@/types/transit.types'

/** Severity as declared by the feed. Higher is worse. */
const SEVERITY_RANK: Record<string, number> = {
  SEVERE: 3,
  WARNING: 2,
  INFO: 1,
}

/**
 * Feeds are inconsistent about setting `severityLevel`, and an unrated alert
 * saying service is suspended is not "minor". Fall back to what the effect
 * implies so ordering and styling stay sensible either way.
 */
const EFFECT_RANK: Record<string, number> = {
  NO_SERVICE: 3,
  SIGNIFICANT_DELAYS: 2,
  REDUCED_SERVICE: 2,
  DETOUR: 2,
  STOP_MOVED: 2,
  MODIFIED_SERVICE: 1,
  ACCESSIBILITY_ISSUE: 1,
  ADDITIONAL_SERVICE: 1,
}

/** 0 = worth mentioning, 1 = notice, 2 = disruption, 3 = don't travel. */
export function alertRank(alert: ServiceAlert): number {
  const rated = SEVERITY_RANK[alert.severity] ?? 0
  return rated > 0 ? rated : (EFFECT_RANK[alert.effect] ?? 0)
}

/** The tone an alert is drawn in. One resolver, so icon and text never disagree. */
export type AlertTone = 'severe' | 'warning' | 'info'

export function alertTone(alert: ServiceAlert): AlertTone {
  const rank = alertRank(alert)
  if (rank >= 3) return 'severe'
  if (rank >= 2) return 'warning'
  return 'info'
}

/** The worst alert in a set — what a single badge should stand for. */
export function worstAlert(alerts: ServiceAlert[]): ServiceAlert | null {
  if (!alerts.length) return null
  return alerts.reduce((worst, a) => (alertRank(a) > alertRank(worst) ? a : worst))
}

/**
 * The short label a chip carries, e.g. "Detour". Falls back to the severity
 * word when the effect says nothing useful, and to null when neither does —
 * a chip with no word is better than a chip reading "Unknown effect".
 */
export function alertEffectKey(alert: ServiceAlert): string | null {
  const EFFECTS = new Set([
    'NO_SERVICE',
    'REDUCED_SERVICE',
    'SIGNIFICANT_DELAYS',
    'DETOUR',
    'ADDITIONAL_SERVICE',
    'MODIFIED_SERVICE',
    'STOP_MOVED',
    'ACCESSIBILITY_ISSUE',
  ])
  if (EFFECTS.has(alert.effect)) return alert.effect
  if (alert.severity === 'SEVERE' || alert.severity === 'WARNING') return alert.severity
  return null
}

/** Every period's parsed bounds, skipping anything the feed wrote unparseably. */
function periods(alert: ServiceAlert): Array<{ start: number | null; end: number | null }> {
  return alert.activePeriods.map(p => {
    const start = p.start ? Date.parse(p.start) : NaN
    const end = p.end ? Date.parse(p.end) : NaN
    return {
      start: Number.isFinite(start) ? start : null,
      end: Number.isFinite(end) ? end : null,
    }
  })
}

/**
 * Is this alert happening *right now*?
 *
 * It has to be asked period by period. Agencies publish recurring work as one
 * alert carrying a window per night — MTA's "trains board from the other
 * platform" alert on the 7 has 58 of them, and one on the Queens Blvd line has
 * 254. Judging by the earliest start instead marks every one of those as in
 * effect from the first night until the last, which is months of a route page
 * insisting that nothing is running normally.
 *
 * No periods at all means "until further notice", which is in effect.
 */
export function isInEffect(alert: ServiceAlert, now = Date.now()): boolean {
  const all = periods(alert)
  if (all.length === 0) return true
  return all.some(p => (p.start === null || p.start <= now) && (p.end === null || p.end >= now))
}

/** Not happening yet, but the agency has committed to a time. */
export function isUpcoming(alert: ServiceAlert, now = Date.now()): boolean {
  if (isInEffect(alert, now)) return false
  return periods(alert).some(p => p.start !== null && p.start > now)
}

/** Nothing left to happen — every window has closed. */
export function hasFinished(alert: ServiceAlert, now = Date.now()): boolean {
  return !isInEffect(alert, now) && !isUpcoming(alert, now)
}

/** When the next window opens, for "starts tonight" and for ordering. */
export function nextStart(alert: ServiceAlert, now = Date.now()): Date | null {
  const starts = periods(alert)
    .map(p => p.start)
    .filter((v): v is number => v !== null && v > now)
  return starts.length ? new Date(Math.min(...starts)) : null
}

/** When the window we are currently inside closes. */
export function currentEnd(alert: ServiceAlert, now = Date.now()): Date | null {
  const ends = periods(alert)
    .filter(p => (p.start === null || p.start <= now) && (p.end === null || p.end >= now))
    .map(p => p.end)
    .filter((v): v is number => v !== null)
  return ends.length ? new Date(Math.min(...ends)) : null
}

/**
 * When the alert took effect, for the "in effect since" footnote. The earliest
 * start across its periods; null when the feed left it open ("until further
 * notice"), which is not something worth printing a date for.
 */
export function alertStart(alert: ServiceAlert): Date | null {
  const starts = periods(alert)
    .map(p => p.start)
    .filter((v): v is number => v !== null)
  return starts.length ? new Date(Math.min(...starts)) : null
}

/** When the alert lifts, if the feed commits to a time. */
export function alertEnd(alert: ServiceAlert): Date | null {
  const ends = periods(alert)
    .map(p => p.end)
    .filter((v): v is number => v !== null)
  return ends.length ? new Date(Math.max(...ends)) : null
}

/**
 * How much this alert deserves a rider's attention, most first.
 *
 * What is happening now outranks everything scheduled, whatever its severity —
 * a rider on the platform cannot act on Thursday's closure, and MTA publishes
 * far more planned work than live disruption.
 *
 * The two groups then order on different things, because different things make
 * them relevant. For something in effect it is severity: you are living it, so
 * the worst news leads. For something scheduled it is imminence: tonight's
 * boarding change matters today in a way that a bigger suspension two days out
 * does not, so the soonest leads and severity only breaks ties.
 */
export function sortByRelevance(alerts: ServiceAlert[], now = Date.now()): ServiceAlert[] {
  const posted = (a: ServiceAlert) =>
    a.postedAt ? Date.parse(a.postedAt) : (alertStart(a)?.getTime() ?? 0)
  const starts = (a: ServiceAlert) => nextStart(a, now)?.getTime() ?? Infinity

  return [...alerts].sort((a, b) => {
    const liveA = isInEffect(a, now)
    const liveB = isInEffect(b, now)
    if (liveA !== liveB) return liveA ? -1 : 1

    if (liveA) {
      const rank = alertRank(b) - alertRank(a)
      return rank !== 0 ? rank : posted(b) - posted(a)
    }

    const soonest = starts(a) - starts(b)
    return soonest !== 0 ? soonest : alertRank(b) - alertRank(a)
  })
}

/**
 * Split a MOTIS id ("feedId_routeId") into its parts. Feed tags carry no
 * underscore, so the first one is the boundary. An id with no underscore is
 * already feed-local and comes back with an empty feed.
 */
export function splitFeedId(id: string): { feedId: string; localId: string } {
  const sep = id.indexOf('_')
  if (sep === -1) return { feedId: '', localId: id }
  return { feedId: id.slice(0, sep), localId: id.slice(sep + 1) }
}

/**
 * Narrow an already-fetched set to the alerts informing one thing.
 *
 * The server answers a whole surface at once — every route on a stop board,
 * every leg of a trip — so this is what lets a single fetch drive per-route
 * badges without a request per bullet.
 *
 * Same rule the server applies: an informed entity constrains only on the
 * dimensions the caller can answer for. MTA scopes almost every subway alert
 * to a route *and* a stop, so letting a stop the caller never named veto the
 * match would empty a route heading of its badge. An entity naming nothing
 * checkable (agency-wide) applies everywhere.
 */
export function alertsFor(
  alerts: ServiceAlert[],
  filter: { routeId?: string; stopId?: string; tripId?: string },
): ServiceAlert[] {
  const { routeId, stopId, tripId } = filter
  if (!routeId && !stopId && !tripId) return alerts

  return alerts.filter(alert =>
    alert.informedEntities.some(entity => {
      const dimensions: Array<[string | undefined, string | undefined]> = [
        [entity.routeId, routeId],
        [entity.stopId, stopId],
        [entity.tripId, tripId],
      ]

      if (dimensions.every(([named]) => !named)) return true

      let checked = 0
      for (const [named, asked] of dimensions) {
        if (!named || !asked) continue
        if (named !== asked) return false
        checked++
      }

      return checked > 0
    }),
  )
}
