/**
 * What stands beside the road at a signal or a railway crossing: mast arms
 * over the arriving lanes, and crossing gates, lights and crossbucks.
 *
 * Barrelman places each with the road markings, as a glyph off the right kerb
 * of the traffic it controls, whose bearing is its `direction`; the glyph
 * names the model. The models face that traffic and reach out over its lanes.
 */
import { DETAIL_SOURCE } from '@/lib/map-style/detail-layers'
import { ROAD_GLYPH_TILES } from '@/lib/map-style/road-markings'
import type { ObjectInstance, ObjectSourceSpec } from './object-layer'
import { bearingOf } from './furniture'
import SIZES from './fixture-sizes.json'

const gate = (lanes: number) => SIZES.gatePivot + Math.min(SIZES.gateLongest, lanes * SIZES.laneWidth + 0.8)

/** Each model's height in metres, which is also its scale: they are built at real size. */
export const FIXTURE_HEIGHTS: Record<string, number> = {
  'signal-1': SIZES.signalPole,
  'signal-2': SIZES.signalPole,
  'signal-3': SIZES.signalPole,
  'signal-4': SIZES.signalPole,
  'crossing-gate-1': gate(1),
  'crossing-gate-2': gate(2),
  'crossing-gate-3': gate(3),
  'crossing-gate-4': gate(4),
  'crossing-lights': SIZES.crossingPole + 0.2,
  crossbuck: SIZES.crossbuckPost,
}

export const FIXTURE_MODELS = Object.fromEntries(Object.keys(FIXTURE_HEIGHTS).map(name => [name, `/models/${name}.glb`]))

export function fixtureInstance(feature: any, lng: number, lat: number): ObjectInstance | null {
  const { glyph, direction } = feature.properties ?? {}
  const height = FIXTURE_HEIGHTS[glyph]
  const travel = Number(direction)
  if (!height || !Number.isFinite(travel)) return null
  return {
    lng,
    lat,
    height,
    spread: height,
    // Facing the traffic, which comes from the opposite way it travels.
    heading: bearingOf((travel + 180) % 360)!,
    shade: 1,
    model: glyph,
  }
}

export const FIXTURE_OBJECTS: ObjectSourceSpec = {
  source: DETAIL_SOURCE,
  sourceLayer: ROAD_GLYPH_TILES,
  minzoom: 17,
  toInstance: fixtureInstance,
}
