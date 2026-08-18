/**
 * Transit types shared between the API and the client.
 *
 * Live transit data is served by Barrelman; these are the shapes it returns,
 * declared here so the web app can import them from `@server/types` the same
 * way it does for places and routing rather than re-declaring them.
 */

/**
 * One entity a service alert informs. Every field is optional in GTFS-RT: an
 * alert naming only an agency applies to everything that agency runs, while
 * one naming a route and a stop applies to that route only at that stop.
 *
 * Ids are feed-local — they carry no feed prefix, so they only mean anything
 * alongside the alert's `feedId`.
 */
export interface InformedEntity {
  agencyId?: string
  routeId?: string
  routeType?: number
  directionId?: number
  tripId?: string
  stopId?: string
}

/** A window during which an alert applies. Both ends are optional. */
export interface AlertActivePeriod {
  /** ISO timestamp; absent means "already in effect". */
  start?: string
  /** ISO timestamp; absent means "until further notice". */
  end?: string
}

/** GTFS-RT severity levels, worst last. */
export type AlertSeverity = 'UNKNOWN_SEVERITY' | 'INFO' | 'WARNING' | 'SEVERE'

/**
 * A disruption published by the agency on its GTFS-RT ServiceAlerts feed —
 * a detour, a suspension, a lift out of service.
 */
export interface ServiceAlert {
  /** Feed-prefixed, so it's unique across agencies. */
  id: string
  feedId: string
  /** GTFS-RT cause, e.g. `CONSTRUCTION`. `UNKNOWN_CAUSE` when unset. */
  cause: string
  /** GTFS-RT effect, e.g. `DETOUR`. `UNKNOWN_EFFECT` when unset. */
  effect: string
  /** Feeds are inconsistent about setting this; treat `UNKNOWN_SEVERITY` as
   *  "read the effect instead" rather than as "minor". */
  severity: AlertSeverity | string
  /** Short summary — the line the agency writes to be read at a glance. */
  header: string
  /** The long prose. Often several paragraphs; the UI collapses it. */
  description?: string
  /** Agency page with more detail, when the feed supplies one. */
  url?: string
  activePeriods: AlertActivePeriod[]
  informedEntities: InformedEntity[]
}

export interface ServiceAlertsResponse {
  alerts: ServiceAlert[]
  /** Per-feed GTFS-RT header timestamp, so clients can judge freshness. */
  feedTimestamps: Record<string, string>
}
