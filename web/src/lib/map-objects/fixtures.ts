/**
 * Signal masts and level crossing gear, stood on barrelman's glyphs: each
 * glyph names its model and gives the bearing of the traffic it faces.
 */
import { DETAIL_SOURCE } from '@/lib/map-style/detail-layers'
import { ROAD_GLYPH_TILES } from '@/lib/map-style/road-markings'
import type { ObjectInstance, ObjectSourceSpec } from './object-layer'
import { FIXTURE_HEIGHTS } from './fixture-sizes.mjs'

export const FIXTURE_MODELS = Object.fromEntries(Object.keys(FIXTURE_HEIGHTS).map(name => [name, `/models/${name}.glb`]))

export function fixtureInstance(feature: any, lng: number, lat: number): ObjectInstance | null {
  const { glyph, direction } = feature.properties ?? {}
  const height = FIXTURE_HEIGHTS[glyph]
  if (!height || typeof direction !== 'number') return null
  return {
    lng,
    lat,
    height,
    spread: height,
    // A model rests facing 180°, so turning it by the traffic's own bearing faces it back at that traffic.
    heading: (direction * Math.PI) / 180,
    shade: 1,
    model: glyph,
  }
}

export const FIXTURE_OBJECTS: ObjectSourceSpec = {
  source: DETAIL_SOURCE,
  sourceLayer: ROAD_GLYPH_TILES,
  minzoom: 17,
  toInstance: fixtureInstance,
  budget: 2000,
}
