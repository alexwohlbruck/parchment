/**
 * Forests: woodland polygons planted with old-growth trees, taller and broader
 * than the street trees of `trees.ts`, kept off the roads, paths, buildings and
 * water that run through them. See `planting.ts` for how an area is planted.
 */
import { SOURCE as BASEMAP_SOURCE } from '@/lib/map-style/build'
import type { ObjectInstance } from './object-layer'
import { cellHash, plantedSpec, type PlantedPlace } from './planting'
import { TREE_FAMILIES } from './trees'
import { lerp, pick } from './vary'

/** About 10 m between trees at US latitudes. */
export const FOREST_GRID = { dx: 13, dy: 13, jitter: 0.8 }

const HEIGHT = { broadleaf: { min: 13, max: 26 }, conifer: { min: 15, max: 30 } }
const SPREAD = { min: 1.1, max: 1.5 }

/** Suffix on a tree's trunkless crown, built alongside it. */
export const CROWN_SUFFIX = '-crown'

/**
 * Below this zoom a wood is planted at every other cell each way, a quarter of
 * the trees, each scaled up to close the canopy over twice the spacing.
 */
export const SPARSE_BELOW_ZOOM = 15
const SPARSE_SCALE = 1.5
const SPARSE_SPREAD = 1.25

const CROWNS: Record<string, string> = Object.fromEntries(
  Object.values(TREE_FAMILIES).flat().map(model => [model, `${model}${CROWN_SUFFIX}`]),
)

export function forestTree(
  lng: number,
  lat: number,
  i: number,
  j: number,
  { interior, sparse }: PlantedPlace = { interior: false, sparse: false },
): ObjectInstance {
  const family = cellHash(i, j, 3) < 0.7 ? 'broadleaf' : 'conifer'
  const height = lerp(HEIGHT[family], cellHash(i, j, 4)) * (sparse ? SPARSE_SCALE : 1)
  const model = pick(TREE_FAMILIES[family], cellHash(i, j, 9))
  return {
    lng,
    lat,
    height,
    spread: height * lerp(SPREAD, cellHash(i, j, 5)) * (sparse ? SPARSE_SPREAD : 1),
    heading: cellHash(i, j, 6) * Math.PI * 2,
    shade: 0.84 + cellHash(i, j, 7) * 0.24,
    tint: cellHash(i, j, 8),
    model: interior && !sparse ? CROWNS[model] : model,
  }
}

export const FOREST_OBJECTS = plantedSpec({
  source: BASEMAP_SOURCE,
  sourceLayer: 'landcover',
  minzoom: 14,
  budget: 10000,
  sparseBelow: SPARSE_BELOW_ZOOM,
  grid: feature => (feature.properties?.class === 'wood' ? FOREST_GRID : null),
  clear: () => true,
  instance: (_feature, lng, lat, i, j, place) => forestTree(lng, lat, i, j, place),
})
