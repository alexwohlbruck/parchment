import { AttributedValue, TransitStopInfo } from '../types/place.types'
import { SOURCE } from './constants'

const WIKIDATA_TRANSITLAND_ONESTOP_ID_PROPERTY = 'P11109'
export function extractOnestopIdFromWikidata(wikidataEntity: any): string | null {
  const onestopIds = extractAllOnestopIdsFromWikidata(wikidataEntity)
  return onestopIds[0] ?? null
}

export function extractAllOnestopIdsFromWikidata(wikidataEntity: any): string[] {
  if (!wikidataEntity?.claims) return []

  const onestopIdClaims = wikidataEntity.claims[WIKIDATA_TRANSITLAND_ONESTOP_ID_PROPERTY]
  if (!onestopIdClaims?.length) return []

  const onestopIds: string[] = []
  for (const claim of onestopIdClaims) {
    const onestopId = claim?.mainsnak?.datavalue?.value
    if (typeof onestopId === 'string') {
      onestopIds.push(onestopId)
    }
  }

  return onestopIds
}

/**
 * OSM tags that mark a place as somewhere riders board, keyed by tag with the
 * values that qualify. Covers every mode our GTFS feeds carry, not just rail —
 * an aerial tramway station (`aerialway=station`) is as much a transit stop as
 * a subway entrance hall, and the modes that never touch a rail tag (ferries,
 * aerial lifts, buses) are the ones most easily missed.
 *
 * Values are deliberately narrow: `aerialway=cable_car` or `railway=rail` tag
 * the *line*, not a stop, and must not match.
 */
const TRANSIT_STOP_TAGS: Record<string, readonly string[]> = {
  public_transport: ['station', 'stop_position', 'platform', 'halt'],
  railway: ['station', 'halt', 'tram_stop', 'platform'],
  aerialway: ['station', 'platform'],
  amenity: ['bus_station', 'ferry_terminal'],
  highway: ['bus_stop', 'platform'],
  // Mode qualifier on a station node — `station=subway` etc.
  station: ['subway', 'light_rail', 'monorail', 'funicular', 'tram'],
}

export function isTransitStopFromTags(tags: Record<string, string> = {}): boolean {
  for (const [tag, values] of Object.entries(TRANSIT_STOP_TAGS)) {
    const value = tags[tag]
    if (value && values.includes(value)) return true
  }

  return false
}

/**
 * GTFS `route_type` values per mode, including the extended (1000+) ranges that
 * real feeds use. Grouped so one OSM tag maps to every code a feed might have
 * chosen for the same thing.
 */
const GTFS_ROUTE_TYPES = {
  tram: [0, 900],
  subway: [1, 400, 401, 402, 405],
  rail: [2, 100, 101, 102, 106, 109],
  bus: [3, 700, 701, 702, 704, 711, 712, 715, 800],
  ferry: [4, 1000, 1200],
  aerial: [5, 6, 1300, 1400], // cable car, aerial lift, funicular
} as const

/**
 * The GTFS route types a place's OSM tags imply, used to prefer a stop of the
 * same mode over a merely closer one. A ferry terminal sits metres from a bus
 * stop and an aerial tramway station sits on top of one, so distance alone
 * picks the wrong stop and the station ends up labelled with a bus route.
 *
 * Returns an empty array when the tags name no particular mode — the caller
 * then falls back to plain nearest-stop matching.
 */
export function getGTFSRouteTypesFromTags(tags: Record<string, string> = {}): number[] {
  const types = new Set<number>()
  const add = (codes: readonly number[]) => codes.forEach((c) => types.add(c))

  if (tags.aerialway) add(GTFS_ROUTE_TYPES.aerial)
  if (tags.amenity === 'ferry_terminal' || tags.ferry) add(GTFS_ROUTE_TYPES.ferry)
  if (tags.amenity === 'bus_station' || tags.highway === 'bus_stop' || tags.bus === 'yes') {
    add(GTFS_ROUTE_TYPES.bus)
  }
  if (tags.railway === 'tram_stop' || tags.station === 'tram' || tags.tram === 'yes') {
    add(GTFS_ROUTE_TYPES.tram)
  }
  if (tags.station === 'subway' || tags.subway === 'yes') add(GTFS_ROUTE_TYPES.subway)
  if (tags.railway === 'station' || tags.railway === 'halt' || tags.train === 'yes') {
    add(GTFS_ROUTE_TYPES.rail)
  }
  if (tags.station === 'light_rail' || tags.light_rail === 'yes') {
    add(GTFS_ROUTE_TYPES.tram)
    add(GTFS_ROUTE_TYPES.subway)
  }
  if (tags.station === 'funicular' || tags.funicular === 'yes') add(GTFS_ROUTE_TYPES.aerial)

  return [...types]
}

export function extractTransitIdentifiers(
  tags: Record<string, string> = {}
): {
  onestopId?: string
  gtfsStopId?: string
  ref?: string
  isTransitStop: boolean
} {
  const result: {
    onestopId?: string
    gtfsStopId?: string
    ref?: string
    isTransitStop: boolean
  } = {
    isTransitStop: isTransitStopFromTags(tags)
  }

  if (!result.isTransitStop) {
    return result
  }

  result.gtfsStopId = 
    tags['gtfs:stop_id'] ||
    tags['gtfs_stop_id'] ||
    tags['GTFS:stop_id'] ||
    tags['transit:stop_id'] ||
    tags['transit_stop_id']

  result.onestopId = 
    tags['transitland:onestop_id'] ||
    tags['onestop_id'] ||
    tags['onestop:id']

  result.ref = tags.ref || tags.stop_id

  return result
}

/** Transit modes, as they appear in a place-type label. */
const TRANSIT_MODE_WORDS = [
  'bus', 'trolleybus', 'train', 'railway', 'rail', 'subway', 'metro', 'tram',
  'light_rail', 'monorail', 'funicular', 'ferry', 'aerialway', 'aerial_tramway',
  'cable_car', 'gondola', 'transit', 'public_transport',
]

/** Words that mark the place as somewhere riders board, rather than the line. */
const TRANSIT_STOP_WORDS = ['station', 'stop', 'platform', 'terminal', 'halt']

/**
 * Fallback detection for sources that give us a place-type label instead of OSM
 * tags (Google, Foursquare, geocoders). A label qualifies when it names both a
 * mode and a boarding point — "Aerialway Station" and "Ferry Stop / Platform"
 * match, while "Cable Car" and "Light Rail Track" (the line itself) do not.
 */
export function isTransitStopType(placeType: string): boolean {
  const normalized = placeType.toLowerCase().replace(/[^a-z0-9]+/g, '_')

  // Generic railway=* fallback label, historically applied to unusual tram stops
  if (normalized.includes('railway_feature')) return true

  return (
    TRANSIT_MODE_WORDS.some((word) => normalized.includes(word)) &&
    TRANSIT_STOP_WORDS.some((word) => normalized.includes(word))
  )
}

export function isTransitStop(placeType: string, tags: Record<string, string> = {}): boolean {
  return isTransitStopType(placeType) || isTransitStopFromTags(tags)
}

export function createTransitInfo(
  tags: Record<string, string>,
  name?: string,
  description?: string
): AttributedValue<TransitStopInfo> | null {
  const transitIds = extractTransitIdentifiers(tags)
  
  if (!transitIds.isTransitStop) return null

  const timestamp = new Date().toISOString()
  
  const transitInfo: TransitStopInfo = {
    onestopId: transitIds.onestopId || '',
    name: name || undefined,
    code: transitIds.ref || transitIds.gtfsStopId,
    description,
  }

  return {
    value: transitInfo,
    sourceId: SOURCE.OSM,
    timestamp,
  }
}
