/**
 * Turns a query that names a point rather than a place into that point:
 * coordinates in any format `parseCoordinateQuery` reads, plus codes (short
 * ones recovered near the map centre or a named town), and what3words
 * addresses.
 */
import {
  parseCoordinateQuery,
  parsePlusCode,
  recoverShortPlusCode,
  type LatLng,
} from '../lib/coordinate-query'
import { forwardGeocode } from './geocoding.service'
import { parseWhat3words, what3wordsToCoordinates } from './what3words.service'
import { logWarn } from '../lib/logger'

export interface CoordinateMatch extends LatLng {
  title: string
  kind: 'Coordinates' | 'Plus code' | 'what3words'
  /** Shown under the title: the kind, or for what3words the nearest town. */
  description: string
}

export async function resolveCoordinateQuery(
  query: string,
  reference?: LatLng,
  signal?: AbortSignal,
): Promise<CoordinateMatch | null> {
  const plusCode = parsePlusCode(query)
  if (plusCode) {
    const point = plusCode.locality
      ? await recoverNearLocality(plusCode.code, plusCode.locality, reference)
      : parseCoordinateQuery(query, reference)
    if (!point) return null
    const title = plusCode.locality ? `${plusCode.code} ${plusCode.locality}` : plusCode.code
    return { ...point, title, kind: 'Plus code', description: 'Plus code' }
  }

  const coords = parseCoordinateQuery(query, reference)
  if (coords) {
    return {
      ...coords,
      title: `${coords.lat}, ${coords.lng}`,
      kind: 'Coordinates',
      description: 'Coordinates',
    }
  }

  const words = parseWhat3words(query)
  if (words) {
    const location = await what3wordsToCoordinates(words, signal)
    if (!location) return null
    return {
      lat: location.lat,
      lng: location.lng,
      title: `///${location.words}`,
      kind: 'what3words',
      description: location.nearestPlace ?? 'what3words',
    }
  }

  return null
}

// A short code is only recovered right within half a degree of its town, so
// the town itself must win over a same-named state or county, which
// geocoders often rank first ("New York, NY" → New York State).
const SETTLEMENT_TYPES = new Set([
  'city', 'town', 'village', 'hamlet', 'suburb', 'borough', 'quarter',
  'neighbourhood', 'neighborhood', 'locality', 'municipality',
])

/** "P2C7+V2 New York, NY": find New York, then the code nearest it. */
async function recoverNearLocality(
  code: string,
  locality: string,
  reference?: LatLng,
): Promise<LatLng | null> {
  try {
    const { results } = await forwardGeocode(locality, reference?.lat, reference?.lng)
    const town =
      results.find((p) => SETTLEMENT_TYPES.has(String(p.placeType?.value ?? '').toLowerCase())) ??
      results[0]
    const center = town?.geometry?.value?.center
    return center ? recoverShortPlusCode(code, center) : null
  } catch (err) {
    logWarn('Could not geocode a plus code locality', err)
    return null
  }
}
