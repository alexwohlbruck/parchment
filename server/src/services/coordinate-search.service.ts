/**
 * Turns a query that names a point rather than a place into that point:
 * coordinates in any format `parseCoordinateQuery` reads, plus codes (short
 * ones recovered near the map centre or a named town), and what3words
 * addresses (computed locally; see lib/whatfreewords).
 */
import {
  parseCoordinateQuery,
  parsePlusCode,
  recoverShortPlusCode,
  type LatLng,
} from '../lib/coordinate-query'
import { forwardGeocode } from './geocoding.service'
import { loadWhatFreeWords, parseWhat3words } from '../lib/whatfreewords'
import { logWarn } from '../lib/logger'

export interface CoordinateMatch extends LatLng {
  title: string
  kind: 'Coordinates' | 'Plus code' | 'what3words'
  /** Shown under the title. */
  description: string
}

export async function resolveCoordinateQuery(
  query: string,
  reference?: LatLng,
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
    const point = await what3wordsToLatLng(words)
    if (!point) return null
    return { ...point, title: `///${words}`, kind: 'what3words', description: 'what3words' }
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

async function what3wordsToLatLng(words: string): Promise<LatLng | null> {
  try {
    return (await loadWhatFreeWords()).wordsToLatLng(words)
  } catch (err) {
    // The data ships beside the bundle (see the build script); without it,
    // three-word queries just fall through to ordinary search.
    logWarn('Could not load the what3words data', err)
    return null
  }
}
