/**
 * Seasons for the 3D plants: the colours their leaves take, and which trees drop them.
 *
 * Broadleaves and cherries change through the year, and in winter stand bare. Conifers,
 * palms and hedges are evergreen and only deepen or dull. Flower beds bloom with the
 * season and lie dormant in winter.
 */
import type { FlavorId } from '@/lib/map-style/build'
import type { ObjectPalette } from './object-layer'
import { TREE_FAMILIES } from './trees'
import { CROWN_SUFFIX } from './forest'

export type Season = 'spring' | 'summer' | 'fall' | 'winter'

/** Latitudes nearer the equator than this keep their leaves all year. */
const EVERGREEN_LATITUDE = 27

/** Meteorological seasons by month, for the northern hemisphere. */
const NORTHERN: Season[] = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'fall', 'fall', 'fall', 'winter']

export function seasonAt(date: Date, lat: number): Season {
  if (Math.abs(lat) < EVERGREEN_LATITUDE) return 'summer'
  const month = lat < 0 ? (date.getMonth() + 6) % 12 : date.getMonth()
  return NORTHERN[month]
}

/** Suffix on a deciduous tree's winter model; see `bareTree` in `build-3d-objects.mjs`. */
export const BARE_SUFFIX = '-bare'

const DECIDUOUS = [...TREE_FAMILIES.broadleaf, ...TREE_FAMILIES.blossom]

/** Models drawn in place of others in a season: in winter every deciduous tree, crown-only or whole, stands bare. */
export function seasonSwaps(season: Season): Record<string, string> {
  if (season !== 'winter') return {}
  return Object.fromEntries(
    DECIDUOUS.flatMap(model => [
      [model, `${model}${BARE_SUFFIX}`],
      [`${model}${CROWN_SUFFIX}`, `${model}${BARE_SUFFIX}`],
    ]),
  )
}

type Rgb = [number, number, number]
/** A role's colour and the one a fully tinted instance moves toward. */
type Pair = [Rgb, Rgb]
type SeasonalRole = 'foliage' | 'needles' | 'frond' | 'shrub' | 'blossom' | 'bloom' | 'twigs'

const TWIGS: Record<FlavorId, Pair> = {
  light: [[0.64, 0.57, 0.52], [0.58, 0.52, 0.5]],
  dark: [[0.22, 0.2, 0.19], [0.2, 0.18, 0.18]],
}

const FRONDS: Record<FlavorId, Pair> = {
  light: [[0.66, 0.83, 0.5], [0.55, 0.77, 0.52]],
  dark: [[0.17, 0.3, 0.17], [0.12, 0.25, 0.18]],
}

/**
 * Leaf colours by season. The tint pair spans the variety a stand shows: in fall it runs
 * from birch gold through maple orange to oak rust, so neighbouring trees differ.
 */
const SEASONS: Record<Season, Record<FlavorId, Record<SeasonalRole, Pair>>> = {
  spring: {
    light: {
      foliage: [[0.76, 0.91, 0.44], [0.66, 0.88, 0.5]],
      needles: [[0.54, 0.75, 0.47], [0.47, 0.69, 0.49]],
      frond: FRONDS.light,
      shrub: [[0.7, 0.88, 0.46], [0.62, 0.84, 0.5]],
      blossom: [[0.98, 0.74, 0.84], [0.99, 0.9, 0.93]],
      bloom: [[0.96, 0.46, 0.58], [0.99, 0.86, 0.34]],
      twigs: TWIGS.light,
    },
    dark: {
      foliage: [[0.22, 0.34, 0.15], [0.17, 0.31, 0.17]],
      needles: [[0.13, 0.26, 0.15], [0.1, 0.22, 0.16]],
      frond: FRONDS.dark,
      shrub: [[0.2, 0.32, 0.15], [0.16, 0.29, 0.17]],
      blossom: [[0.36, 0.24, 0.3], [0.4, 0.3, 0.35]],
      bloom: [[0.44, 0.2, 0.26], [0.46, 0.4, 0.16]],
      twigs: TWIGS.dark,
    },
  },
  summer: {
    light: {
      foliage: [[0.66, 0.83, 0.5], [0.55, 0.77, 0.52]],
      needles: [[0.5, 0.7, 0.46], [0.43, 0.64, 0.48]],
      frond: FRONDS.light,
      shrub: [[0.64, 0.81, 0.49], [0.54, 0.75, 0.5]],
      blossom: [[0.6, 0.8, 0.48], [0.52, 0.75, 0.5]],
      bloom: [[0.9, 0.52, 0.68], [0.96, 0.82, 0.36]],
      twigs: TWIGS.light,
    },
    dark: {
      foliage: [[0.17, 0.3, 0.17], [0.12, 0.25, 0.18]],
      needles: [[0.12, 0.24, 0.15], [0.09, 0.2, 0.16]],
      frond: FRONDS.dark,
      shrub: [[0.16, 0.29, 0.17], [0.12, 0.25, 0.18]],
      blossom: [[0.15, 0.28, 0.16], [0.11, 0.24, 0.17]],
      bloom: [[0.42, 0.24, 0.32], [0.46, 0.4, 0.18]],
      twigs: TWIGS.dark,
    },
  },
  fall: {
    light: {
      foliage: [[0.95, 0.76, 0.3], [0.8, 0.32, 0.18]],
      needles: [[0.48, 0.66, 0.45], [0.42, 0.6, 0.46]],
      frond: FRONDS.light,
      shrub: [[0.64, 0.7, 0.42], [0.76, 0.42, 0.26]],
      blossom: [[0.93, 0.56, 0.28], [0.78, 0.28, 0.2]],
      bloom: [[0.94, 0.62, 0.22], [0.64, 0.22, 0.3]],
      twigs: TWIGS.light,
    },
    dark: {
      foliage: [[0.4, 0.3, 0.12], [0.33, 0.14, 0.09]],
      needles: [[0.12, 0.22, 0.14], [0.09, 0.19, 0.15]],
      frond: FRONDS.dark,
      shrub: [[0.2, 0.25, 0.13], [0.3, 0.16, 0.1]],
      blossom: [[0.38, 0.22, 0.11], [0.32, 0.12, 0.09]],
      bloom: [[0.42, 0.26, 0.1], [0.3, 0.1, 0.14]],
      twigs: TWIGS.dark,
    },
  },
  winter: {
    light: {
      foliage: [[0.7, 0.58, 0.42], [0.62, 0.5, 0.4]],
      needles: [[0.4, 0.56, 0.42], [0.35, 0.5, 0.43]],
      frond: [[0.62, 0.78, 0.48], [0.52, 0.72, 0.5]],
      shrub: [[0.52, 0.6, 0.42], [0.6, 0.52, 0.42]],
      blossom: [[0.7, 0.58, 0.42], [0.62, 0.5, 0.4]],
      bloom: [[0.6, 0.5, 0.4], [0.54, 0.46, 0.38]],
      twigs: TWIGS.light,
    },
    dark: {
      foliage: [[0.26, 0.21, 0.15], [0.22, 0.18, 0.14]],
      needles: [[0.1, 0.19, 0.13], [0.08, 0.16, 0.13]],
      frond: [[0.16, 0.27, 0.16], [0.11, 0.23, 0.17]],
      shrub: [[0.17, 0.2, 0.13], [0.2, 0.17, 0.13]],
      blossom: [[0.26, 0.21, 0.15], [0.22, 0.18, 0.14]],
      bloom: [[0.22, 0.18, 0.14], [0.2, 0.17, 0.13]],
      twigs: TWIGS.dark,
    },
  },
}

/** The season's leaf colours as palette entries, each role with its `-alt`. */
export function seasonPalette(season: Season, flavor: FlavorId): ObjectPalette {
  return Object.fromEntries(
    Object.entries(SEASONS[season][flavor]).flatMap(([role, [color, alt]]) => [
      [role, color],
      [`${role}-alt`, alt],
    ]),
  )
}
