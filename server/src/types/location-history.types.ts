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
  range: { start: Date; end: Date }
  /** IANA timezone, used to bucket `dailyStats` correctly. Defaults to UTC. */
  timezone?: string
}
