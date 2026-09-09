import type { Place } from '../types/place.types'
import { isPermanentlyClosedByOsmTags } from './osm-lifecycle'

/**
 * The OSM tags for a place, however its source happened to record them.
 *
 * Sources disagree on where tags land. Barrelman — our primary place source —
 * stores the raw OSM tag map in `tags` and leaves `amenities` empty, while the
 * Overpass and Nominatim adapters lift a curated subset into `amenities` as
 * attributed values. Anything that classifies a place by its tags (transit stop
 * detection, parent-relation lookups) has to read both, or it silently sees
 * nothing for whichever source it wasn't written against.
 *
 * `type:`-prefixed amenity keys are skipped: they hold Google/Foursquare
 * category ids, not OSM tags.
 */
export function getPlaceOsmTags(place: Pick<Place, 'tags' | 'amenities'>): Record<string, string> {
  const tags: Record<string, string> = {}

  for (const [key, attr] of Object.entries(place.amenities || {})) {
    if (key.startsWith('type:')) continue

    const value = attr && typeof attr === 'object' && 'value' in attr ? attr.value : attr
    if (typeof value === 'string') tags[key] = value
    else if (typeof value === 'boolean') tags[key] = value ? 'yes' : 'no'
    else if (typeof value === 'number') tags[key] = String(value)
  }

  // Raw OSM tags win — they carry the tagging the classifiers were written for.
  return { ...tags, ...(place.tags || {}) }
}

/**
 * Whether a place is permanently closed, from either the hours a source
 * resolved or the place's own OSM lifecycle tags.
 *
 * Both halves matter: sources that carry no hours at all still tag the closure,
 * and sources with their own closure signal (Google, Foursquare) carry no OSM
 * tags to read.
 */
export function isPlacePermanentlyClosed(
  place: Pick<Place, 'tags' | 'amenities' | 'openingHours'>,
): boolean {
  if (place.openingHours?.value?.isPermanentlyClosed) return true
  return isPermanentlyClosedByOsmTags(getPlaceOsmTags(place))
}
