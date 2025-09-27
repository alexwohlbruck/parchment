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

export function isTransitStopFromTags(tags: Record<string, string> = {}): boolean {
  const transitTags = [
    'public_transport',
    'railway',
    'light_rail',
    'station',
    'highway'
  ]
  
  const transitValues = [
    'station',
    'stop_position', 
    'platform',
    'halt',
    'tram_stop',
    'light_rail',
    'yes'
  ]
  
  for (const tag of transitTags) {
    const value = tags[tag]
    if (value && transitValues.includes(value)) {
      return true
    }
  }
  
  if (tags.highway === 'bus_stop') return true
  if (tags.amenity === 'bus_station') return true
  if (tags.amenity === 'ferry_terminal') return true
  
  return false
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

export function generatePotentialOnestopId(lat: number, lng: number, name?: string): string {
  const latStr = Math.round(lat * 100000).toString(36)
  const lngStr = Math.round(lng * 100000).toString(36)
  const geohash = `${latStr}${lngStr}`.substring(0, 8)
  
  let namepart = ''
  if (name) {
    namepart = name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .substring(0, 20)
  }
  
  return `s-${geohash}-${namepart}`
}

export function isTransitStopType(placeType: string): boolean {
  const transitTypes = [
    'bus_stop',
    'bus_station', 
    'railway_station',
    'railway_halt',
    'railway_feature', // Covers tram stops that might be classified as "Railway Feature"
    'subway_station',
    'train_station',
    'tram_stop',
    'ferry_terminal',
    'transit_station',
    'public_transport_stop',
    'light_rail'
  ]
  
  const normalizedPlaceType = placeType.toLowerCase()
  
  return transitTypes.some(type => 
    normalizedPlaceType.includes(type) || 
    normalizedPlaceType.includes(type.replace('_', ' '))
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

export function getGTFSRouteType(tags: Record<string, string> = {}): number {
  if (tags.route === 'tram' || tags.railway === 'tram') return 0
  if (tags.route === 'subway' || tags.railway === 'subway') return 1
  if (tags.route === 'train' || tags.railway === 'rail') return 2
  if (tags.route === 'bus' || tags.highway === 'bus_stop') return 3
  if (tags.route === 'ferry') return 4
  if (tags.route === 'cable_car') return 5
  if (tags.route === 'gondola') return 6
  if (tags.route === 'funicular') return 7
  
  return 3
}
