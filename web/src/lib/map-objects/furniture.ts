/**
 * Street furniture: benches, tables, racks, bins, lamps, bollards, fountains and
 * billboards.
 *
 * `direction` is the compass bearing an object faces. Barrelman fills it from
 * OSM where mapped and otherwise from the nearest road or path, so most objects
 * with a front arrive with one. Those still without one are skipped when a wrong
 * angle would read as a mistake, and drawn at a hashed angle when it would not.
 */
import { FURNITURE_SOURCE, FURNITURE_TILES } from '@/lib/map-style/detail-layers'
import type { ObjectInstance, ObjectSourceSpec } from './object-layer'
import { hash, tagged } from './vary'

export const FURNITURE_MODELS = {
  'waste-basket': '/models/waste-basket.glb',
  recycling: '/models/recycling.glb',
  bench: '/models/bench.glb',
  'picnic-table': '/models/picnic-table.glb',
  'bike-rack': '/models/bike-rack.glb',
  'drinking-water': '/models/drinking-water.glb',
  fountain: '/models/fountain.glb',
  'street-lamp': '/models/street-lamp.glb',
  bollard: '/models/bollard.glb',
  billboard: '/models/billboard.glb',
}

type FurnitureModel = keyof typeof FURNITURE_MODELS

/** Real heights, in metres; each model's own proportions give its footprint. */
const HEIGHT: Record<FurnitureModel, number> = {
  'waste-basket': 0.94,
  recycling: 0.94,
  bench: 1.16,
  'picnic-table': 0.77,
  'bike-rack': 0.85,
  'drinking-water': 1.0,
  fountain: 2.08,
  'street-lamp': 4.42,
  bollard: 0.92,
  billboard: 9.1,
}

/** Barrelman's `kind` values, and the model each draws as. */
const MODEL_FOR: Record<string, FurnitureModel> = {
  waste_basket: 'waste-basket',
  recycling: 'recycling',
  waste_disposal: 'recycling',
  bench: 'bench',
  picnic_table: 'picnic-table',
  bicycle_parking: 'bike-rack',
  drinking_water: 'drinking-water',
  fountain: 'fountain',
  street_lamp: 'street-lamp',
  bollard: 'bollard',
  billboard: 'billboard',
}

/** Models whose front is obvious enough that a guessed angle looks wrong. */
const NEEDS_DIRECTION = new Set<FurnitureModel>(['bench', 'picnic-table', 'billboard'])

/** The eight compass points, for `direction=NE` and friends. */
const COMPASS: Record<string, number> = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5,
  E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5,
  W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
}

/**
 * Which way an unrotated model faces, as a compass bearing.
 *
 * A model is authored Y-up with its front towards -Z, and the layer swaps that
 * to the map's Z-up as `(x, -z, y)` — so -Z becomes +Y, and mercator's +Y is
 * *south*. An untouched bench therefore faces 180°, not 0°, and a heading is
 * the turn from there rather than from north.
 */
const MODEL_RESTING_BEARING = 180

/**
 * The model rotation, in radians, that points a thing at a compass bearing.
 *
 * `direction` is documented as degrees but written both ways in practice, so
 * both are read.
 *
 * The conversion is a rotation *from* the model's resting bearing, and the
 * layer's rotation is clockwise: its `(x cos - y sin, x sin + y cos)` runs in
 * a frame where +X is east and +Y is south, which reads clockwise on a
 * north-up screen. So a bearing maps to `bearing - 180`.
 *
 * Getting this wrong is not subtle and was not caught by eye: the first
 * version negated the bearing, which faces a bench at `180 - bearing`, and a
 * bench tagged 130° came out facing 43°. It happens to be right at 90°, which
 * is exactly the kind of coincidence that survives a spot check.
 */
export function bearingOf(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null
  const text = String(value).trim().toUpperCase()
  const compass = COMPASS[text]
  const degrees = compass ?? tagged(text, -360, 360)
  if (degrees === null) return null
  return ((degrees - MODEL_RESTING_BEARING) * Math.PI) / 180
}

/**
 * The bearing a heading actually points at — the inverse of `bearingOf`, for
 * tests and for anything that needs to check the round trip.
 */
export function headingToBearing(heading: number): number {
  return (((heading * 180) / Math.PI + MODEL_RESTING_BEARING) % 360 + 360) % 360
}

export function furnitureInstance(feature: any, lng: number, lat: number): ObjectInstance | null {
  const props = feature.properties ?? {}
  const model = MODEL_FOR[props.kind]
  if (!model) return null

  const seed = props.id ?? feature.id ?? `${lng},${lat}`
  const heading = bearingOf(props.direction)
  if (heading === null && NEEDS_DIRECTION.has(model)) return null

  const height = HEIGHT[model]
  return {
    lng,
    lat,
    height,
    // The models are built at true proportions and normalised to one unit
    // tall, so they scale evenly: width follows height.
    spread: height,
    heading: heading ?? hash(seed, 7) * Math.PI * 2,
    // Manufactured things vary less than planting does.
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
