import type { Map as MaplibreMap } from 'maplibre-gl'
import type { LngLat } from '@/types/map.types'
import type { RoadGlyph } from '@/lib/guidance/lanes'
import { DETAIL_SOURCE } from '@/lib/map-style/detail-layers'
import { ROAD_GLYPH_TILES } from '@/lib/map-style/road-markings'

const SEARCH_DEGREES = 0.0015

/** Turn arrows from the detail tiles already loaded around `at`. */
export function roadGlyphsNear(map: MaplibreMap, at: LngLat): RoadGlyph[] {
  let features: GeoJSON.Feature[] = []
  try {
    features = map.querySourceFeatures(DETAIL_SOURCE, { sourceLayer: ROAD_GLYPH_TILES })
  } catch {
    return []
  }
  const glyphs: RoadGlyph[] = []
  for (const f of features) {
    if (f.geometry.type !== 'Point') continue
    const [lng, lat] = f.geometry.coordinates
    if (Math.abs(lat - at.lat) > SEARCH_DEGREES || Math.abs(lng - at.lng) > SEARCH_DEGREES * 1.5) continue
    const glyph = f.properties?.glyph
    if (typeof glyph !== 'string' || !glyph.startsWith('road-arrow')) continue
    glyphs.push({ glyph, direction: Number(f.properties?.direction ?? 0), position: { lat, lng } })
  }
  return glyphs
}
