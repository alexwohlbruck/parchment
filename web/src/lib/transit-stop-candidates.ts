/**
 * Transit stop click → stop candidates.
 *
 * Pure logic for turning the map features under a click (queryRenderedFeatures
 * over the transit stop layers, source `transit_stops`) into a deduplicated,
 * stable-ordered list of stop candidates for the stop-detail click-through:
 *
 *   - exactly one candidate → navigate straight to the stop detail page
 *   - several (opposite-curb bus stop pairs, stacked platforms) → the
 *     disambiguation popover lists them alongside any route candidates
 *
 * The id space is Parchment's own GTFS data (Barrelman): `feed_id` +
 * `stop_id` key the /transit/stop/:feedId/:stopId destination, whose data is
 * served by the transit widget endpoint (Barrelman departures + routes).
 *
 * Kept free of map/router imports so it is trivially unit-testable.
 */

/** A clickable stop resolved from `transit_stops` tile features. */
export interface TransitStopCandidate {
  /** GTFS feed id (barrelman id space, e.g. '29') — stop detail param. */
  feedId: string
  /** GTFS stop id within the feed — stop detail param. */
  stopId: string
  /** Display name (`stop_name`, OSM-conflated upstream); null when blank. */
  name: string | null
  /** Stop location from the point feature geometry; null when absent. */
  lngLat: { lng: number; lat: number } | null
  /** Served by any non-bus route (rail/tram/ferry) — sorts before bus. */
  isRail: boolean
  /** Representative route colour WITHOUT '#' (single-route stops) or null. */
  routeColor: string | null
  /** Distinct routes serving the stop, when the tile carries the count. */
  routeCount: number | null
}

/** Minimal feature shape accepted (queryRenderedFeatures results qualify). */
export interface TransitStopFeatureLike {
  properties?: Record<string, unknown> | null
  geometry?: { type?: string; coordinates?: unknown } | null
}

function asString(value: unknown): string | null {
  if (typeof value === 'string' && value !== '') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value !== '' && !Number.isNaN(+value)) {
    return +value
  }
  return null
}

function asBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === 1
}

/** Point coordinates from a (possibly tiled) feature geometry. */
function pointLngLat(
  geometry: TransitStopFeatureLike['geometry'],
): { lng: number; lat: number } | null {
  if (!geometry || geometry.type !== 'Point') return null
  const coords = geometry.coordinates
  if (!Array.isArray(coords) || coords.length < 2) return null
  const [lng, lat] = coords
  if (typeof lng !== 'number' || typeof lat !== 'number') return null
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
  return { lng, lat }
}

/** Merge a duplicate candidate into the kept one, filling missing fields. */
function mergeCandidate(
  kept: TransitStopCandidate,
  next: TransitStopCandidate,
): void {
  kept.name ??= next.name
  kept.lngLat ??= next.lngLat
  kept.routeColor ??= next.routeColor
  kept.routeCount ??= next.routeCount
  kept.isRail ||= next.isRail
}

function candidateFromFeature(
  feature: TransitStopFeatureLike,
): TransitStopCandidate | null {
  const properties = feature?.properties
  if (!properties) return null
  const feedId = asString(properties.feed_id)
  const stopId = asString(properties.stop_id)
  if (!feedId || !stopId) return null
  return {
    feedId,
    stopId,
    name: asString(properties.stop_name),
    lngLat: pointLngLat(feature.geometry),
    isRail: asBoolean(properties.is_rail),
    routeColor: asString(properties.route_color),
    routeCount: asNumber(properties.route_count),
  }
}

/** Natural-order compare so '2' < '10' and names sort alphabetically. */
const naturalCompare = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
}).compare

function compareCandidates(
  a: TransitStopCandidate,
  b: TransitStopCandidate,
): number {
  // Rail stops before bus stops, then natural name order, then stop id so
  // unnamed opposite-curb pairs still order deterministically.
  if (a.isRail !== b.isRail) return a.isRail ? -1 : 1
  const byName = naturalCompare(a.name ?? '', b.name ?? '')
  if (byName !== 0) return byName
  return naturalCompare(a.stopId, b.stopId)
}

/**
 * Collect the distinct stop candidates from the transit stop features under
 * a click. Stops are deduped across features (tile-boundary duplicates, a
 * stop hit through several stop layers), keyed by (feedId, stopId);
 * duplicate hits enrich missing fields. Result order is deterministic:
 * rail first, then natural name order.
 */
export function collectStopCandidates(
  features: readonly TransitStopFeatureLike[],
): TransitStopCandidate[] {
  const byKey = new Map<string, TransitStopCandidate>()

  for (const feature of features) {
    const candidate = candidateFromFeature(feature)
    if (!candidate) continue
    // NUL separator (escaped — a raw byte would make this file binary to
    // git) since it cannot appear inside a feed or stop id.
    const key = `${candidate.feedId}\u0000${candidate.stopId}`
    const kept = byKey.get(key)
    if (kept) {
      mergeCandidate(kept, candidate)
    } else {
      byKey.set(key, candidate)
    }
  }

  return [...byKey.values()].sort(compareCandidates)
}
