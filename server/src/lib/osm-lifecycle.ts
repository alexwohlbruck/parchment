/**
 * OSM lifecycle prefixes — detecting places that no longer exist.
 *
 * OSM retires a feature by prefixing its *primary* tag rather than adding a
 * boolean: a closed cafe becomes `disused:amenity=cafe`, not `disused=yes`.
 * The prefixed form is the dominant convention, so a check that only looks for
 * the boolean misses most permanently closed places and goes on to evaluate
 * their stale `opening_hours` as "Open now".
 *
 * https://wiki.openstreetmap.org/wiki/Lifecycle_prefix
 */

/** Lifecycle prefixes that mean the feature is gone for good. */
const CLOSED_LIFECYCLE_PREFIXES = new Set([
  'disused',
  'abandoned',
  'demolished',
  'razed',
  'removed',
  'destroyed',
  'was',
])

/**
 * Primary feature keys — the tag that says what a place *is*.
 *
 * A prefix only means "permanently closed" when it qualifies the primary tag.
 * `demolished:date=2019` and `was:name=Old Cafe` record a still-live feature's
 * history, so matching on the prefix alone would close places that are open.
 */
const PRIMARY_FEATURE_KEYS = new Set([
  'aeroway',
  'amenity',
  'barrier',
  'building',
  'club',
  'craft',
  'emergency',
  'healthcare',
  'highway',
  'historic',
  'landuse',
  'leisure',
  'man_made',
  'military',
  'natural',
  'office',
  'place',
  'power',
  'public_transport',
  'railway',
  'shop',
  'sport',
  'tourism',
  'waterway',
])

/** Values that negate a tag rather than setting it. */
const NEGATED_VALUES = new Set(['no', 'false', ''])

/**
 * Whether an OSM tag map marks the feature as permanently closed.
 *
 * Accepts both the boolean form (`disused=yes`) and the lifecycle-prefix form
 * (`disused:amenity=cafe`, `demolished:building=yes`).
 */
export function isPermanentlyClosedByOsmTags(
  tags?: Record<string, string> | null,
): boolean {
  if (!tags) return false

  for (const [key, value] of Object.entries(tags)) {
    if (typeof value !== 'string') continue
    if (NEGATED_VALUES.has(value.trim().toLowerCase())) continue

    const separator = key.indexOf(':')

    // Boolean form — `disused=yes`, `abandoned=yes`
    if (separator === -1) {
      if (CLOSED_LIFECYCLE_PREFIXES.has(key)) return true
      continue
    }

    // Prefixed form — `disused:amenity=cafe`, `demolished:building=yes`
    const prefix = key.slice(0, separator)
    const qualified = key.slice(separator + 1)
    if (
      CLOSED_LIFECYCLE_PREFIXES.has(prefix) &&
      PRIMARY_FEATURE_KEYS.has(qualified)
    ) {
      return true
    }
  }

  return false
}
