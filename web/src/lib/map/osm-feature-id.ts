/** OSM ids as they arrive on vector-tile features, per tile schema. */

export function parseMapboxToOsmId(featureId: string | number): {
  osmId: string
  poiType: 'node' | 'way' | 'relation' | 'unknown'
} {
  const typeCode = String(featureId).slice(-1)
  const osmId = String(featureId).slice(0, -1)

  const poiTypeCodeMap: {
    [key: string]: 'node' | 'way' | 'relation' | 'unknown'
  } = {
    '0': 'node',
    '1': 'way',
    '2': 'unknown',
    '3': 'unknown',
    '4': 'relation',
  }

  return {
    osmId,
    poiType: poiTypeCodeMap[typeCode] || 'unknown',
  }
}

/**
 * Parse a Planetiler/OpenMapTiles MVT feature ID into an OSM ID and type.
 * Planetiler encodes as: feature.id = osm_id * 10 + type_code
 * where type_code: 1=node, 2=way, 3=relation
 */
export function parsePlanetilerOsmId(featureId: string | number): {
  osmId: string
  poiType: 'node' | 'way' | 'relation' | 'unknown'
} {
  const id = typeof featureId === 'string' ? parseInt(featureId, 10) : featureId
  if (isNaN(id) || id <= 0) return { osmId: '0', poiType: 'unknown' }

  const typeCode = id % 10
  const osmId = Math.floor(id / 10)

  const poiTypeCodeMap: Record<number, 'node' | 'way' | 'relation'> = {
    1: 'node',
    2: 'way',
    3: 'relation',
  }

  return {
    osmId: String(osmId),
    poiType: poiTypeCodeMap[typeCode] || 'unknown',
  }
}
