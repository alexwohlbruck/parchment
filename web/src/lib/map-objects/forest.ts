/**
 * Forests: woodland polygons planted with old-growth trees, taller and broader
 * than the street trees of `trees.ts`, kept off the roads, paths, buildings and
 * water that run through them. See `planting.ts` for how an area is planted.
 */
import { SOURCE as BASEMAP_SOURCE } from '@/lib/map-style/build'
import { DETAIL_SOURCE, WOOD_TILES } from '@/lib/map-style/detail-layers'
import models from './models.json'
import type { ObjectInstance } from './object-layer'
import { cellHash, plantedSpec, type PlantedPlace } from './planting'
import { TREE_FAMILIES, treeFamily, type TreeFamily } from './trees'
import { lerp, pick } from './vary'

/** About 10 m between trees at US latitudes. */
export const FOREST_GRID = { dx: 13, dy: 13, jitter: 0.8 }

const HEIGHT: Record<TreeFamily, { min: number; max: number }> = {
  broadleaf: { min: 13, max: 26 },
  conifer: { min: 15, max: 30 },
  pine: { min: 17, max: 32 },
  palm: { min: 10, max: 20 },
  fanPalm: { min: 10, max: 22 },
  datePalm: { min: 8, max: 15 },
  blossom: { min: 6, max: 11 },
}
const SPREAD = { min: 1.1, max: 1.5 }

/** Suffix on a tree's trunkless crown, built alongside it. */
export const CROWN_SUFFIX = '-crown'

/**
 * Below this zoom a wood is planted at every other cell each way, a quarter of
 * the trees, each scaled up to close the canopy over twice the spacing. Farther
 * off it thins further (see `plantedSpec`'s falloff), and each level past the
 * first grows its trees by `LEVEL_*` more, up to `MAX_GROWTH` levels.
 */
export const SPARSE_BELOW_ZOOM = 15
const SPARSE_SCALE = 1.5
const SPARSE_SPREAD = 1.25
const LEVEL_HEIGHT = 1.12
const LEVEL_SPREAD = 1.3
const MAX_GROWTH = 3

/** Height and spread multipliers for a tree at thinning level `level`: #585's sparse scale at 1, gentler past it. */
export function levelGrowth(level: number): { height: number; spread: number } {
  const g = Math.max(0, Math.min(level, MAX_GROWTH))
  const first = Math.min(g, 1)
  const rest = Math.max(0, g - 1)
  return {
    height: (1 + (SPARSE_SCALE - 1) * first) * LEVEL_HEIGHT ** rest,
    spread: (1 + (SPARSE_SPREAD - 1) * first) * LEVEL_SPREAD ** rest,
  }
}

const CROWNS: Record<string, string> = Object.fromEntries(
  Object.values(TREE_FAMILIES)
    .flat()
    .filter(model => `${model}${CROWN_SUFFIX}` in models)
    .map(model => [model, `${model}${CROWN_SUFFIX}`]),
)

/** What a wood says grows in it, from barrelman's `woods` tiles. */
export type WoodTags = { leaf_type?: string; genus?: string }

/** Share of broadleaves by `leaf_type`. No bare model exists, so leafless woods stay broadleaf. */
const BROADLEAF_SHARE: Record<string, number> = { broadleaved: 1, leafless: 1, mixed: 0.5, needleleaved: 0 }
const UNTAGGED_BROADLEAF_SHARE = 0.7

/** The family a wood's tree at a cell belongs to: its genus, else its leaf type's mix. */
export function woodFamily(wood: WoodTags, i: number, j: number): TreeFamily {
  if (wood.genus) return treeFamily(wood)
  const share = BROADLEAF_SHARE[wood.leaf_type ?? ''] ?? UNTAGGED_BROADLEAF_SHARE
  return cellHash(i, j, 3) < share ? 'broadleaf' : 'conifer'
}

export function forestTree(
  lng: number,
  lat: number,
  i: number,
  j: number,
  { interior = false, sparse = false, level = sparse ? 1 : 0, wood = {} }: Partial<PlantedPlace> & { wood?: WoodTags } = {},
): ObjectInstance {
  const family = woodFamily(wood, i, j)
  const growth = levelGrowth(level)
  const height = lerp(HEIGHT[family], cellHash(i, j, 4)) * growth.height
  const model = pick(TREE_FAMILIES[family], cellHash(i, j, 9))
  return {
    lng,
    lat,
    height,
    spread: height * lerp(SPREAD, cellHash(i, j, 5)) * growth.spread,
    heading: cellHash(i, j, 6) * Math.PI * 2,
    shade: 0.84 + cellHash(i, j, 7) * 0.24,
    tint: cellHash(i, j, 8),
    model: interior && level < 1 ? (CROWNS[model] ?? model) : model,
  }
}

/** Tags of the woods in view that carry any, by basemap feature id. */
let woods = new Map<number | string, WoodTags>()

function woodsIn(map: any): Map<number | string, WoodTags> {
  const out = new Map<number | string, WoodTags>()
  try {
    for (const f of map.querySourceFeatures(DETAIL_SOURCE, { sourceLayer: WOOD_TILES }))
      if (f.id != null) out.set(f.id, f.properties)
  } catch {}
  return out
}

export const FOREST_OBJECTS = plantedSpec({
  source: BASEMAP_SOURCE,
  sourceLayer: 'landcover',
  minzoom: 14,
  falloff: { full: 18000 },
  sparseBelow: SPARSE_BELOW_ZOOM,
  grid: feature => (feature.properties?.class === 'wood' ? FOREST_GRID : null),
  clear: () => true,
  prepare: map => { woods = woodsIn(map) },
  instance: (feature, lng, lat, i, j, place) =>
    forestTree(lng, lat, i, j, { ...place, wood: (feature.id != null && woods.get(feature.id)) || {} }),
})
