/** Flagsticks on golf greens, from barrelman's `golf_features` pins. */
import { DETAIL_SOURCE, GOLF_FLAG_MINZOOM, GOLF_TILES } from '@/lib/map-style/detail-layers'
import type { ObjectInstance, ObjectSourceSpec } from './object-layer'
import { hash } from './vary'

export const GOLF_MODELS = {
  'golf-flag': '/models/golf-flag.glb',
}

/** A 7 ft flagstick, drawn 2.5x so it reads from above a green; true size is a few pixels at z19. */
const FLAG_HEIGHT = 2.13 * 2.5

export function golfFlagInstance(feature: any, lng: number, lat: number): ObjectInstance | null {
  if (feature.properties?.kind !== 'pin') return null
  const seed = feature.id ?? `${lng},${lat}`
  return {
    lng,
    lat,
    height: FLAG_HEIGHT,
    spread: FLAG_HEIGHT,
    heading: hash(seed, 7) * Math.PI * 2,
    shade: 1,
    model: 'golf-flag',
  }
}

export const GOLF_OBJECTS: ObjectSourceSpec = {
  source: DETAIL_SOURCE,
  sourceLayer: GOLF_TILES,
  minzoom: GOLF_FLAG_MINZOOM,
  toInstance: golfFlagInstance,
}
