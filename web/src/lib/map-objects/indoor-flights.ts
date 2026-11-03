/** Escalators and stairs as models, climbing from the floor each venue is showing. */
import { FLIGHT_MODEL_HEIGHT, FLIGHT_RISE } from '@/lib/indoor/indoor-sizes.mjs'
import { EXTERIOR_LEVEL, INDOOR_MAP_TILES, INDOOR_SOURCE, INDOOR_STATE } from '@/lib/map-style/indoor-layers'
import type { FlavorId } from '@/lib/map-style/build'
import type { ObjectInstance, ObjectPalette, ObjectSourceSpec } from './object-layer'
import models from './models.json'

export const INDOOR_FLIGHT_MODELS: Record<string, string> = Object.fromEntries(
  Object.keys(models).filter(name => /^(escalator|stairs)(-far)?$/.test(name)).map(name => [name, `/models/${name}.glb`]),
)

type Shown = { venue: number; level: number | null }

/** The level a venue is showing, as the style's `shownLevel` reads it. */
export function shownLevel(p: { venue?: unknown; default_level?: unknown }, shown: Shown): number | null {
  if (p.venue === shown.venue) return shown.level
  const fallback = Number(p.default_level)
  return fallback < 0 ? EXTERIOR_LEVEL : fallback
}

export function flightInstance(p: Record<string, any> | null, lng: number, lat: number, shown: Shown): ObjectInstance | null {
  if (p?.kind !== 'flight' || p.level !== shownLevel(p, shown)) return null
  const { width, length, bearing } = p
  if (!(width > 0 && length > 0) || typeof bearing !== 'number') return null
  return {
    lng,
    lat,
    height: FLIGHT_MODEL_HEIGHT,
    spread: FLIGHT_MODEL_HEIGHT,
    width,
    length,
    heading: ((bearing - 90) * Math.PI) / 180,
    rise: FLIGHT_RISE,
    shade: 1,
    model: p.class === 'escalator' ? 'escalator' : 'stairs',
  }
}

let shown: Shown = { venue: 0, level: null }

export const INDOOR_FLIGHT_OBJECTS: ObjectSourceSpec = {
  source: INDOOR_SOURCE,
  sourceLayer: INDOOR_MAP_TILES,
  minzoom: 17,
  prepare: map => {
    const state = map.getGlobalState?.() ?? {}
    shown = { venue: state[INDOOR_STATE.venue] ?? 0, level: state[INDOOR_STATE.level] ?? null }
  },
  toInstance: (feature, lng, lat) => flightInstance(feature.properties, lng, lat, shown),
}

/** Escalators in the floor plan's blue, stairs in its stone, under pale balustrades. */
export const INDOOR_FLIGHT_PALETTE: Record<FlavorId, ObjectPalette> = {
  light: {
    escalator: [0.62, 0.74, 0.93],
    'escalator-edge': [0.82, 0.88, 0.97],
    stair: [0.91, 0.9, 0.88],
    'stair-edge': [0.68, 0.68, 0.7],
    balustrade: [0.95, 0.96, 0.98],
    handrail: [0.5, 0.6, 0.78],
  },
  dark: {
    escalator: [0.27, 0.36, 0.55],
    'escalator-edge': [0.4, 0.48, 0.66],
    stair: [0.36, 0.38, 0.44],
    'stair-edge': [0.5, 0.52, 0.58],
    balustrade: [0.46, 0.5, 0.58],
    handrail: [0.2, 0.26, 0.38],
  },
}
