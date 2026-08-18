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

/**
 * When the alert took effect, for the "in effect since" footnote. The earliest
 * start across its periods; null when the feed left it open ("until further
 * notice"), which is not something worth printing a date for.
 */
export function alertStart(alert: ServiceAlert): Date | null {
  const starts = alert.activePeriods
    .map(p => (p.start ? Date.parse(p.start) : NaN))
    .filter(Number.isFinite)
  return starts.length ? new Date(Math.min(...starts)) : null
}

/** When the alert lifts, if the feed commits to a time. */
export function alertEnd(alert: ServiceAlert): Date | null {
  const ends = alert.activePeriods
    .map(p => (p.end ? Date.parse(p.end) : NaN))
    .filter(Number.isFinite)
  return ends.length ? new Date(Math.max(...ends)) : null
}

/** Has this alert's window not opened yet? Those are listed separately. */
export function isUpcoming(alert: ServiceAlert, now = Date.now()): boolean {
  const start = alertStart(alert)
  return start !== null && start.getTime() > now
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

/** Sort worst-first, then most recently in effect. Mutates nothing. */
export function sortAlerts(alerts: ServiceAlert[]): ServiceAlert[] {
  return [...alerts].sort((a, b) => {
    const rank = alertRank(b) - alertRank(a)
    if (rank !== 0) return rank
    return (alertStart(b)?.getTime() ?? 0) - (alertStart(a)?.getTime() ?? 0)
  })
}

/**
 * Narrow an already-fetched set to the alerts informing one thing.
 *
 * The server answers a whole surface at once — every route on a stop board,
 * every leg of a trip — so this is what lets a single fetch drive per-route
 * badges without a request per bullet. Same rule the server applies: an
 * informed entity constrains on every field it names, and one that names
 * nothing checkable (agency-wide) applies everywhere.
 */
export function alertsFor(
  alerts: ServiceAlert[],
  filter: { routeId?: string; stopId?: string; tripId?: string },
): ServiceAlert[] {
  const { routeId, stopId, tripId } = filter
  if (!routeId && !stopId && !tripId) return alerts

  return alerts.filter(alert =>
    alert.informedEntities.some(entity => {
      if (!entity.routeId && !entity.stopId && !entity.tripId) return true

      if (entity.routeId && entity.routeId !== routeId) return false
      if (entity.stopId && entity.stopId !== stopId) return false
      if (entity.tripId && entity.tripId !== tripId) return false

      return Boolean(
        (entity.routeId && routeId) ||
        (entity.stopId && stopId) ||
        (entity.tripId && tripId),
      )
    }),
  )
}
