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

/** `GET /api/v1/timeline?start_at&end_at&distance_unit=km` */
export interface DawarichTimelineResponse {
  days: DawarichTimelineDay[]
}

export interface DawarichTimelineDay {
  /** YYYY-MM-DD, in the Dawarich user's timezone. */
  date: string
  summary: DawarichTimelineDaySummary
  bounds?: {
    sw_lat: number
    sw_lng: number
    ne_lat: number
    ne_lng: number
  }
  entries: DawarichTimelineEntry[]
}

export interface DawarichTimelineDaySummary {
  /** In `distance_unit` from the request (we always send `km`). */
  total_distance: number
  distance_unit: 'km' | 'mi'
  places_visited: number
  time_moving_minutes: number
  time_stationary_minutes: number
  suggested_count: number
  confirmed_count: number
  declined_count: number
}

export type DawarichTimelineEntry =
  | DawarichTimelineVisitEntry
  | DawarichTimelineJourneyEntry

export interface DawarichTimelineVisitEntry {
  type: 'visit'
  visit_id: number
  name: string | null
  editable_name: string | null
  status: string // 'suggested' | 'confirmed' | 'declined'
  place_id: number | null
  point_count: number
  tags: string[]
  started_at: string // ISO 8601
  ended_at: string // ISO 8601
  /** MINUTES — Dawarich's `Visit#duration` is stored in minutes. */
  duration: number
  place: {
    name: string | null
    lat: number | null
    lng: number | null
    city: string | null
    country: string | null
  } | null
  area?: unknown
  suggested_places?: unknown
}

export interface DawarichTimelineJourneyEntry {
  type: 'journey'
  track_id: number
  started_at: string // ISO 8601
  ended_at: string // ISO 8601
  /** SECONDS. */
  duration: number
  /** In `distance_unit`. We always request `km`. */
  distance: number
  distance_unit: 'km' | 'mi'
  dominant_mode: string | null
  avg_speed: number
  speed_unit: string
  elevation_gain?: number
  elevation_loss?: number
}

/**
 * `GET /api/v1/tracks` — GeoJSON FeatureCollection. We only use this for
 * geometry now; the entry list and per-day summaries come from `/timeline`.
 */
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
    start_at: string
    end_at: string
    distance: number // meters
    avg_speed: number
    duration: number // seconds
    dominant_mode: string | null
    dominant_mode_emoji?: string
  }
}

// ── Adapter ─────────────────────────────────────────────────────────────────

const KM_TO_M = 1000
const MI_TO_M = 1609.344

function toMeters(value: number, unit: 'km' | 'mi'): number {
  return unit === 'mi' ? value * MI_TO_M : value * KM_TO_M
}

/**
 * Trailing place-type annotation in Dawarich names: `… (House)`,
 * `… (Residential)`, `… (Hotel)`. Captures one parenthesised group at the
 * very end with optional trailing whitespace.
 */
const TRAILING_PARENS_RE = /\s*\([^()]*\)\s*$/

function stripPlaceTypeParens(name: string | null): string | null {
  if (!name) return name
  const cleaned = name.replace(TRAILING_PARENS_RE, '').trim()
  return cleaned.length > 0 ? cleaned : name
}

/** ~1.1 m at the equator. Tight enough that two distinct addresses don't
 *  collide; loose enough to absorb Dawarich's coordinate rounding. */
const SAME_PLACE_LAT_LNG_TOLERANCE = 1e-5

function sameStopPlace(
  a: LocationHistoryStop,
  b: LocationHistoryStop,
): boolean {
  return (
    Math.abs(a.coordinate.lat - b.coordinate.lat) <
      SAME_PLACE_LAT_LNG_TOLERANCE &&
    Math.abs(a.coordinate.lng - b.coordinate.lng) <
      SAME_PLACE_LAT_LNG_TOLERANCE
  )
}

export class DawarichAdapter {
  /**
   * Transform Dawarich's `/api/v1/timeline` response into the unified
   * `LocationHistory` shape. Geometry for journey entries is looked up by
   * `track_id` from a separate `/api/v1/tracks` index call.
   *
   * `instanceUrl` is hashed (not exposed) so the client can distinguish
   * responses across self-hosted instances without ever logging the URL.
   */
  toLocationHistory(input: {
    timeline: DawarichTimelineResponse
    /** Map of `track_id → coordinates` from the /tracks index call. */
    geometryByTrackId: Map<number, Coordinate[]>
    /** Entries window — stops + segments shown in the list. */
    range: { start: Date; end: Date }
    /** Chart window — daily distance bars. Defaults to the entries range. */
    statsRange?: { start: Date; end: Date }
    timezone: string
    instanceUrl: string
  }): LocationHistory {
    const {
      timeline,
      geometryByTrackId,
      range,
      statsRange = range,
      timezone,
      instanceUrl,
    } = input

    // Collect raw entries across all days first — we need ALL visits to
    // split journeys correctly, regardless of day grouping.
    const allVisits: DawarichTimelineVisitEntry[] = []
    const allJourneys: DawarichTimelineJourneyEntry[] = []
    for (const day of timeline.days) {
      for (const e of day.entries) {
        if (e.type === 'visit') allVisits.push(e)
        else allJourneys.push(e)
      }
    }

    const rangeStartMs = range.start.getTime()
    const rangeEndMs = range.end.getTime()

    const stops: LocationHistoryStop[] = []
    for (const v of allVisits) {
      const stop = this.toStop(v)
      if (!stop) continue
      const a = Date.parse(stop.startTime)
      const b = Date.parse(stop.endTime)
      if (b < rangeStartMs || a > rangeEndMs) continue
      stops.push(stop)
    }

    // Split each journey at every visit that falls inside it. Dawarich's
    // /timeline returns one journey per "track" — but a 4-hour bike ride
    // with multiple stops along the way only ships as a single entry.
    // Without splitting, the journey would render as one row that bookends
    // every dropped-by visit instead of the obvious "ride → stop → ride →
    // stop" chronology.
    //
    // Zero-distance sub-segments (Dawarich's GPS-jitter "journeys") are
    // dropped — they're noise that makes the timeline look broken without
    // adding any signal.
    const segments: LocationHistorySegment[] = []
    for (const journey of allJourneys) {
      const geometry = geometryByTrackId.get(journey.track_id) ?? []
      const subs = this.splitJourney(journey, allVisits, geometry)
      for (const seg of subs) {
        if (seg.distance <= 0) continue
        const a = Date.parse(seg.startTime)
        const b = Date.parse(seg.endTime)
        if (b < rangeStartMs || a > rangeEndMs) continue
        segments.push(seg)
      }
    }

    const sorted: LocationHistoryEntry[] = [...stops, ...segments].sort(
      (a, b) => Date.parse(a.startTime) - Date.parse(b.startTime),
    )

    // Merge consecutive stops at the same place. With zero-distance journeys
    // filtered out, two visits at "Home" with only GPS-noise journeys between
    // them collapse into one continuous stay — the user was effectively at
    // home the whole time.
    const entries = this.mergeAdjacentStops(sorted)

    this.linkStopsAndSegments(entries)

    const dailyStats = this.computeDailyStats(timeline, statsRange, timezone)

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

  toStop(entry: DawarichTimelineVisitEntry): LocationHistoryStop | null {
    const lat = entry.place?.lat
    const lng = entry.place?.lng
    if (lat == null || lng == null) return null

    // Derive duration in seconds from timestamps directly — robust against
    // Dawarich shipping `duration` in minutes here.
    const durationSec = Math.max(
      0,
      Math.round(
        (Date.parse(entry.ended_at) - Date.parse(entry.started_at)) / 1000,
      ),
    )

    const rawName =
      entry.editable_name?.trim() ||
      entry.name?.trim() ||
      entry.place?.name?.trim() ||
      null
    // Dawarich appends `(House)`, `(Residential)`, `(Hotel)`, etc. to place
    // names — useful internally, but reads as raw API output in our UI.
    // Strip the trailing parenthetical for display.
    const displayName = stripPlaceTypeParens(rawName)

    const formatted = this.formatPlaceAddress(entry.place, displayName)

    return {
      type: 'stop',
      id: `dawarich-visit-${entry.visit_id}`,
      name: displayName,
      address: formatted ? { formatted } : null,
      coordinate: { lat, lng },
      startTime: entry.started_at,
      endTime: entry.ended_at,
      duration: durationSec,
      category: entry.status,
    }
  }

  /**
   * Split a journey at every visit that falls inside its time range. A long
   * bike ride that dropped by 5 places ships from Dawarich as ONE journey;
   * we want to render it as `ride → stop → ride → stop → ride …` so the
   * chronology in the entries list matches what actually happened.
   *
   * Distance / duration / geometry for each sub-segment are estimated by
   * time-fraction of the parent journey — Dawarich doesn't expose
   * per-coordinate timestamps, so this is the best we can do without an
   * extra data source. The map polyline is unchanged: the union of
   * sub-segment slices equals the original track.
   *
   * If a journey has no inner visits, returns one segment for the whole
   * journey. If a single visit fully contains the journey (e.g. brief GPS
   * jitter while at home), returns nothing — the visit absorbs the noise.
   */
  splitJourney(
    journey: DawarichTimelineJourneyEntry,
    allVisits: DawarichTimelineVisitEntry[],
    geometry: Coordinate[],
  ): LocationHistorySegment[] {
    const journeyStart = Date.parse(journey.started_at)
    const journeyEnd = Date.parse(journey.ended_at)
    const totalMs = journeyEnd - journeyStart
    if (totalMs <= 0) return []

    const totalDistanceM = toMeters(journey.distance, journey.distance_unit)
    const totalDurationSec = journey.duration

    const inner = allVisits
      .map((v) => ({
        start: Math.max(Date.parse(v.started_at), journeyStart),
        end: Math.min(Date.parse(v.ended_at), journeyEnd),
      }))
      .filter(({ start, end }) => start < end)
      .sort((a, b) => a.start - b.start)

    if (inner.length === 0) {
      return [
        {
          type: 'segment',
          id: `dawarich-track-${journey.track_id}`,
          mode: this.mapMode(journey.dominant_mode),
          startTime: journey.started_at,
          endTime: journey.ended_at,
          duration: totalDurationSec,
          distance: totalDistanceM,
          geometry,
        },
      ]
    }

    // First pass: figure out the gaps between visits (the "moving" windows).
    const gaps: { start: number; end: number }[] = []
    let cursor = journeyStart
    for (const visit of inner) {
      if (visit.start > cursor) gaps.push({ start: cursor, end: visit.start })
      if (visit.end > cursor) cursor = visit.end
    }
    if (cursor < journeyEnd) gaps.push({ start: cursor, end: journeyEnd })

    const totalMovingMs = gaps.reduce((sum, g) => sum + (g.end - g.start), 0)
    if (totalMovingMs <= 0) return []

    // Scale distance/duration by share of MOVING time (excluding visit time)
    // so the sub-journeys together sum to the parent journey's totals.
    //
    // Geometry is sliced so adjacent sub-journeys are CONTIGUOUS — each
    // sub's slice runs from its own start to the NEXT sub's start (or
    // journey end for the last). The "tail" stationary cluster at the
    // arriving visit is absorbed into the previous sub's polyline so the
    // map renders a continuous route, not a string of disconnected
    // fragments separated by visit-time gaps.
    const out: LocationHistorySegment[] = []
    const len = geometry.length
    gaps.forEach((g, i) => {
      const fraction = (g.end - g.start) / totalMovingMs
      const sliceEndMs = i + 1 < gaps.length ? gaps[i + 1].start : journeyEnd
      const startFrac = (g.start - journeyStart) / totalMs
      const endFrac = (sliceEndMs - journeyStart) / totalMs
      const startIdx = Math.max(0, Math.min(len, Math.floor(startFrac * len)))
      const endIdx = Math.max(startIdx, Math.min(len, Math.ceil(endFrac * len)))
      out.push({
        type: 'segment',
        id: `dawarich-track-${journey.track_id}-${i}`,
        mode: this.mapMode(journey.dominant_mode),
        startTime: new Date(g.start).toISOString(),
        endTime: new Date(g.end).toISOString(),
        duration: Math.round(totalDurationSec * fraction),
        distance: Math.round(totalDistanceM * fraction),
        geometry: geometry.slice(startIdx, endIdx),
      })
    })

    return out
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /**
   * Show only the city — country adds no signal when every row is in the
   * same one and reads as noise. Suppress entirely when the displayed name
   * already contains the city (e.g. street-level place names that include
   * the city) so we don't render a redundant second line.
   */
  private formatPlaceAddress(
    place: DawarichTimelineVisitEntry['place'],
    displayName: string | null,
  ): string | null {
    const city = place?.city?.trim()
    if (!city) return null
    if (displayName && displayName.toLowerCase().includes(city.toLowerCase())) {
      return null
    }
    return city
  }

  /**
   * Map Dawarich's mode strings — `walking | running | cycling | driving |
   * bus | train | flying | boat | motorcycle | stationary | unknown` — onto
   * the unified `TravelMode` enum. No speed-based fallback: if Dawarich says
   * it doesn't know, we render WALKING as a placeholder rather than guessing.
   */
  private mapMode(dominant: string | null): TravelMode {
    if (!dominant) return TravelMode.WALKING
    const lower = dominant.toLowerCase()
    if (lower === 'walking' || lower === 'running' || lower.includes('foot'))
      return TravelMode.WALKING
    if (lower === 'cycling' || lower.includes('bik') || lower.includes('cycl'))
      return TravelMode.CYCLING
    if (lower === 'motorcycle') return TravelMode.MOTORCYCLE
    if (lower === 'truck') return TravelMode.TRUCK
    if (lower === 'wheelchair') return TravelMode.WHEELCHAIR
    if (lower === 'driving' || lower === 'automotive' || lower === 'car')
      return TravelMode.DRIVING
    if (
      lower === 'bus' ||
      lower === 'train' ||
      lower === 'tram' ||
      lower === 'subway' ||
      lower === 'rail' ||
      lower === 'transit' ||
      lower === 'boat' ||
      lower === 'ferry' ||
      lower === 'flying' ||
      lower === 'plane' ||
      lower === 'airplane'
    )
      return TravelMode.TRANSIT
    return TravelMode.WALKING
  }

  /**
   * Collapse two consecutive stops at the same place into one. Triggered
   * after we drop zero-distance journeys: if Dawarich split a long stay
   * into multiple visits with only GPS-noise journeys between them, those
   * visits land back-to-back here and should read as a single continuous
   * stay.
   *
   * Same-place is determined by coordinate proximity (~1m tolerance).
   * Merged stop spans from the earliest start to the latest end; duration
   * becomes the wall-clock span (not the sum of original durations) since
   * the user was effectively at the place the whole time.
   */
  private mergeAdjacentStops(
    entries: LocationHistoryEntry[],
  ): LocationHistoryEntry[] {
    const out: LocationHistoryEntry[] = []
    for (const e of entries) {
      const last = out[out.length - 1]
      if (
        e.type === 'stop' &&
        last &&
        last.type === 'stop' &&
        sameStopPlace(last, e)
      ) {
        const start = Math.min(
          Date.parse(last.startTime),
          Date.parse(e.startTime),
        )
        const end = Math.max(Date.parse(last.endTime), Date.parse(e.endTime))
        last.startTime = new Date(start).toISOString()
        last.endTime = new Date(end).toISOString()
        last.duration = Math.max(0, Math.round((end - start) / 1000))
      } else {
        out.push(e)
      }
    }
    return out
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

  /**
   * Per-day distance bars come from the `/timeline` `summary.total_distance`
   * field (already pre-aggregated in the user's timezone by Dawarich). We
   * key by `day.date` directly and fill zero-distance days for the whole
   * stats range so the chart renders a contiguous strip.
   */
  private computeDailyStats(
    timeline: DawarichTimelineResponse,
    range: { start: Date; end: Date },
    timezone: string,
  ): LocationHistoryDailyStats[] {
    const byDate = new Map<string, DawarichTimelineDaySummary>()
    for (const day of timeline.days) byDate.set(day.date, day.summary)

    const result: LocationHistoryDailyStats[] = []
    const cursor = new Date(range.start)
    cursor.setUTCHours(12, 0, 0, 0) // mid-day to avoid TZ boundary slips
    const end = new Date(range.end)
    while (cursor.getTime() <= end.getTime()) {
      const key = this.formatDateInTz(cursor, timezone)
      const summary = byDate.get(key)
      result.push({
        date: key,
        distance: summary
          ? toMeters(summary.total_distance, summary.distance_unit)
          : 0,
        duration: summary ? summary.time_moving_minutes * 60 : 0,
      })
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
    return result
  }

  private formatDateInTz(date: Date, timezone: string): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date)
  }

  private hashInstanceUrl(url: string): string {
    return createHash('sha256')
      .update(url.replace(/\/+$/, ''))
      .digest('hex')
      .slice(0, 16)
  }
}
