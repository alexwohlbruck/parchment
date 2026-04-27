import type { Coordinate, TravelMode } from './unified-routing.types'
import type { Address } from './place.types'
import type { IntegrationId } from './integration.enums'

/**
 * Unified location-history domain types.
 *
 * Built so any tracker (Dawarich today, OwnTracks / Home Assistant later) can
 * map its native shape into the same wire format via an adapter. Field names
 * follow the routing/trip conventions already in use: `distance` is meters,
 * `duration` is seconds, times are ISO 8601 strings.
 *
 * Stops and segments are interleaved in `entries` so the timeline list and
 * the map renderer iterate one ordered stream.
 */

export interface LocationHistoryStop {
  type: 'stop'
  id: string
  name: string | null
  address: Address | null
  coordinate: Coordinate
  startTime: string // ISO 8601
  endTime: string // ISO 8601
  duration: number // seconds
  /** Optional category/classification when the source provides one. */
  category?: string | null
}

export interface LocationHistorySegment {
  type: 'segment'
  id: string
  mode: TravelMode
  startTime: string // ISO 8601
  endTime: string // ISO 8601
  duration: number // seconds
  distance: number // meters
  /** Polyline of the travel path. May be decimated by the adapter. */
  geometry: Coordinate[]
  fromStopId?: string
  toStopId?: string
}

export type LocationHistoryEntry = LocationHistoryStop | LocationHistorySegment

export interface LocationHistoryDailyStats {
  /** YYYY-MM-DD, in the timezone supplied with the request. */
  date: string
  distance: number // meters
  duration: number // seconds
}

export interface LocationHistoryRange {
  start: string // ISO 8601
  end: string // ISO 8601
}

export interface LocationHistory {
  range: LocationHistoryRange
  /** Chronologically ordered stops and segments. */
  entries: LocationHistoryEntry[]
  /** One row per day in the requested chart window — independent of `entries`. */
  dailyStats: LocationHistoryDailyStats[]
  source: {
    integrationId: IntegrationId
    /**
     * Hash of the upstream instance URL. Lets the client distinguish responses
     * from different self-hosted instances without exposing the URL itself.
     */
    instanceUrlHash?: string
  }
}

export interface LocationHistoryRequest {
  /** Window for the stops + segments list. */
  range: { start: Date; end: Date }
  /**
   * Window for `dailyStats` (the daily-distance chart). Wider than `range`
   * so the chart shows neighbouring-day context even in single-day mode.
   * Defaults to `range` if omitted.
   */
  statsRange?: { start: Date; end: Date }
  /** IANA timezone, used to bucket `dailyStats` correctly. Defaults to UTC. */
  timezone?: string
}

/**
 * "You've been here N times" — past-visit aggregate at a specific
 * coordinate, surfaced on the place-detail page. Looked up by lat/lng
 * (within a small radius) since OSM IDs aren't queryable from Dawarich.
 */
export interface PlaceVisitHistoryRequest {
  lat: number
  lng: number
  /** Search radius in meters. Defaults to ~75 m server-side. */
  radius?: number
  /** Cap on `recentVisits.length` to keep payloads small. Defaults to 5. */
  recentLimit?: number
}

export interface PlaceVisitSummary {
  id: string
  startTime: string // ISO 8601
  endTime: string // ISO 8601
  duration: number // seconds
}

export interface PlaceVisitHistory {
  /** Total times the user has visited this place. 0 if no match. */
  totalVisits: number
  /** Most recent visit start time, or null if never visited. */
  lastVisit: string | null
  /** Earliest visit start time, or null if never visited. */
  firstVisit: string | null
  /** Sum of all visit durations in seconds. */
  totalDuration: number
  /**
   * Most-recent visits, capped at `request.recentLimit`. Newest first.
   * May be empty even when `totalVisits > 0` if the upstream couldn't
   * resolve individual visits cheaply (e.g. very large place histories).
   */
  recentVisits: PlaceVisitSummary[]
  source: {
    integrationId: IntegrationId
    instanceUrlHash?: string
  }
}
