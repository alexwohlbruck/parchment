import { createHash } from 'node:crypto'
import type { Coordinate } from '../../../types/unified-routing.types'
import { TravelMode } from '../../../types/unified-routing.types'
import { IntegrationId } from '../../../types/integration.enums'
import type {
  LocationHistory,
  LocationHistoryDailyStats,
  LocationHistoryEntry,
  LocationHistorySegment,
  LocationHistoryStop,
} from '../../../types/location-history.types'

// ── Raw Dawarich response shapes ────────────────────────────────────────────

/** `GET /api/v1/visits` — bare array of these. */
export interface DawarichVisit {
  id: number
  area_id: number | null
  user_id: number
  started_at: string // ISO 8601
  ended_at: string // ISO 8601
  duration: number // seconds
  name: string | null
  status: string // 'suggested' | 'confirmed' | 'declined' | …
  place: {
    latitude: number | null
    longitude: number | null
    id: number | null
  }
}

/** `GET /api/v1/tracks` — GeoJSON FeatureCollection. */
export interface DawarichTracksResponse {
  type: 'FeatureCollection'
  features: DawarichTrackFeature[]
}

export interface DawarichTrackFeature {
  type: 'Feature'
  geometry: {
    type: 'LineString'
    coordinates: [number, number][] // [lng, lat]
  }
  properties: {
    id: number
    color: string
    start_at: string // ISO 8601
    end_at: string // ISO 8601
    distance: number // meters
    avg_speed: number
    duration: number // seconds
    dominant_mode: string | null
    dominant_mode_emoji?: string
  }
}

// ── Adapter ─────────────────────────────────────────────────────────────────

export class DawarichAdapter {
  /**
   * Transform raw Dawarich responses into the unified `LocationHistory` shape.
   *
   * Strategy:
   *   - Stops come from `/visits` (Dawarich already detects stays).
   *   - Segments come from `/tracks` (GeoJSON, with mode + distance + duration).
   *   - Daily stats are aggregated from tracks, bucketed by the request timezone.
   *   - Adjacent stop/segment pairs are linked via `fromStopId` / `toStopId`.
   *
   * `instanceUrl` is hashed (not exposed) so the client can distinguish responses
   * across self-hosted instances without ever logging the URL itself.
   */
  toLocationHistory(input: {
    visits: DawarichVisit[]
    tracks: DawarichTracksResponse
    range: { start: Date; end: Date }
    timezone: string
    instanceUrl: string
  }): LocationHistory {
    const { visits, tracks, range, timezone, instanceUrl } = input

    const stops = visits
      .map((v) => this.toStop(v))
      .filter((s): s is LocationHistoryStop => s !== null)

    const segments = tracks.features.map((f) => this.toSegment(f))

    const entries: LocationHistoryEntry[] = [...stops, ...segments].sort(
      (a, b) => Date.parse(a.startTime) - Date.parse(b.startTime),
    )

    this.linkStopsAndSegments(entries)

    const dailyStats = this.computeDailyStats(tracks.features, range, timezone)

    return {
      range: {
        start: range.start.toISOString(),
        end: range.end.toISOString(),
      },
      entries,
      dailyStats,
      source: {
        integrationId: IntegrationId.DAWARICH,
        instanceUrlHash: this.hashInstanceUrl(instanceUrl),
      },
    }
  }

  toStop(visit: DawarichVisit): LocationHistoryStop | null {
    const lat = visit.place?.latitude
    const lng = visit.place?.longitude
    if (lat == null || lng == null) return null

    return {
      type: 'stop',
      id: `dawarich-visit-${visit.id}`,
      name: visit.name,
      address: null, // Dawarich visits don't carry a formatted address
      coordinate: { lat, lng },
      startTime: visit.started_at,
      endTime: visit.ended_at,
      duration: visit.duration,
      category: visit.status,
    }
  }

  toSegment(feature: DawarichTrackFeature): LocationHistorySegment {
    const props = feature.properties
    const geometry: Coordinate[] = feature.geometry.coordinates.map(
      ([lng, lat]) => ({ lat, lng }),
    )
    return {
      type: 'segment',
      id: `dawarich-track-${props.id}`,
      mode: this.mapMode(props.dominant_mode),
      startTime: props.start_at,
      endTime: props.end_at,
      duration: props.duration,
      distance: props.distance,
      geometry,
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private mapMode(dominant: string | null): TravelMode {
    if (!dominant) return TravelMode.WALKING
    const lower = dominant.toLowerCase()
    if (lower.includes('walk') || lower.includes('run') || lower.includes('foot'))
      return TravelMode.WALKING
    if (lower.includes('bik') || lower.includes('cycl'))
      return TravelMode.CYCLING
    if (lower.includes('motorcycle')) return TravelMode.MOTORCYCLE
    if (lower.includes('truck')) return TravelMode.TRUCK
    if (
      lower.includes('drive') ||
      lower.includes('car') ||
      lower.includes('motor') ||
      lower.includes('automotive')
    )
      return TravelMode.DRIVING
    if (
      lower.includes('transit') ||
      lower.includes('train') ||
      lower.includes('bus') ||
      lower.includes('rail')
    )
      return TravelMode.TRANSIT
    return TravelMode.WALKING
  }

  private linkStopsAndSegments(entries: LocationHistoryEntry[]): void {
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]
      if (e.type !== 'segment') continue
      const prev = entries[i - 1]
      const next = entries[i + 1]
      if (prev?.type === 'stop') e.fromStopId = prev.id
      if (next?.type === 'stop') e.toStopId = next.id
    }
  }

  private computeDailyStats(
    tracks: DawarichTrackFeature[],
    range: { start: Date; end: Date },
    timezone: string,
  ): LocationHistoryDailyStats[] {
    const buckets = new Map<string, { distance: number; duration: number }>()

    for (const track of tracks) {
      const key = this.formatDateInTz(
        new Date(track.properties.start_at),
        timezone,
      )
      const bucket = buckets.get(key) ?? { distance: 0, duration: 0 }
      bucket.distance += track.properties.distance
      bucket.duration += track.properties.duration
      buckets.set(key, bucket)
    }

    const result: LocationHistoryDailyStats[] = []
    const cursor = new Date(range.start)
    cursor.setUTCHours(0, 0, 0, 0)
    const end = new Date(range.end)
    while (cursor.getTime() <= end.getTime()) {
      const key = this.formatDateInTz(cursor, timezone)
      const bucket = buckets.get(key) ?? { distance: 0, duration: 0 }
      result.push({
        date: key,
        distance: bucket.distance,
        duration: bucket.duration,
      })
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
    return result
  }

  private formatDateInTz(date: Date, timezone: string): string {
    // en-CA produces YYYY-MM-DD reliably across implementations.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date)
  }

  private hashInstanceUrl(url: string): string {
    // Truncated SHA-256. Lets the client tell instances apart without
    // letting the URL itself reach any log or persistence layer.
    return createHash('sha256')
      .update(url.replace(/\/+$/, ''))
      .digest('hex')
      .slice(0, 16)
  }
}
