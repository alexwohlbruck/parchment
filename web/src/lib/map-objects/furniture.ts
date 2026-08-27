/**
 * Street furniture: bins, recycling containers and benches.
 *
 * Small enough that they only earn their place at the closest zooms, and small
 * enough that being *wrong* is cheap — nobody navigates by a bin. What they do
 * is make a street read as somewhere people are rather than as a diagram of
 * where the tarmac is.
 *
 * Benches are the one object with an orientation worth having, and OSM has a
 * tag for it — `direction`, the compass bearing the seat faces. Only about one
 * bench in thirty carries it, and a bench pointed the wrong way reads worse
 * than no bench at all: it is furniture, so a wrong angle looks like a mistake
 * where a wrong tree does not. So the untagged ones are skipped.
 */
import { FURNITURE_SOURCE, FURNITURE_TILES } from '@/lib/map-style/detail-layers'
import type { ObjectInstance, ObjectSourceSpec } from './object-layer'
import { hash, tagged } from './vary'

export const FURNITURE_MODELS = {
  'waste-basket': '/models/waste-basket.glb',
  recycling: '/models/recycling.glb',
  bench: '/models/bench.glb',
}

/** Real sizes, in metres: height, then the longest horizontal dimension. */
const SIZE = {
  'waste-basket': { height: 0.94, spread: 0.5 },
  recycling: { height: 1.1, spread: 0.82 },
  bench: { height: 0.91, spread: 1.8 },
}

/** `amenity` values that share a model. */
const MODEL_FOR: Record<string, keyof typeof SIZE> = {
  waste_basket: 'waste-basket',
  recycling: 'recycling',
  waste_disposal: 'recycling',
  bench: 'bench',
}

/** The eight compass points, for `direction=NE` and friends. */
const COMPASS: Record<string, number> = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5,
  E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5,
  W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
}

/**
 * A compass bearing in radians, or null.
 *
 * `direction` is documented as degrees but written both ways in practice, so
 * both are read. The map's heading runs the other way round from a compass
 * bearing — bearings go clockwise from north, the model's rotation goes
 * anticlockwise — hence the negation.
 */
export function bearingOf(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null
  const text = String(value).trim().toUpperCase()
  const compass = COMPASS[text]
  const degrees = compass ?? tagged(text, -360, 360)
  if (degrees === null) return null
  return (-degrees * Math.PI) / 180
}

export function furnitureInstance(feature: any, lng: number, lat: number): ObjectInstance | null {
  const props = feature.properties ?? {}
  const model = MODEL_FOR[props.kind]
  if (!model) return null

  const seed = props.id ?? feature.id ?? `${lng},${lat}`
  const heading = bearingOf(props.direction)
  // A bench without a bearing is skipped; a bin is a drum and looks the same
  // from every side, so it takes a hashed angle and nobody is any the wiser.
  if (model === 'bench' && heading === null) return null

  const size = SIZE[model]
  return {
    lng,
    lat,
    height: size.height,
    spread: size.spread,
    heading: heading ?? hash(seed, 7) * Math.PI * 2,
    // Furniture varies less than planting does: these are manufactured, and a
    // row of visibly different bins would read as a mistake.
    shade: 0.94 + hash(seed, 8) * 0.12,
    model,
  }
}

export const FURNITURE_OBJECTS: ObjectSourceSpec = {
  source: FURNITURE_SOURCE,
  sourceLayer: FURNITURE_TILES,
  // A bench is 1.8m: below this it is under a pixel and its presence would be
  // the only thing showing, which is worse than its absence.
  minzoom: 17,
  toInstance: furnitureInstance,
}
