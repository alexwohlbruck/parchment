/**
 * Forests: woodland polygons planted with trees, taller and broader than the
 * street trees of `trees.ts`, kept off the roads, paths, buildings and water
 * that run through them. See `planting.ts` for how an area is planted.
 */
import { SOURCE as BASEMAP_SOURCE } from '@/lib/map-style/build'
import type { ObjectInstance } from './object-layer'
import { cellHash, plantedSpec } from './planting'
import { TREE_FAMILIES } from './trees'
import { lerp, pick } from './vary'

/** About 10 m between trees at US latitudes. */
export const FOREST_GRID = { dx: 13, dy: 13, jitter: 0.8 }

const HEIGHT = { broadleaf: { min: 11, max: 24 }, conifer: { min: 13, max: 27 } }
const SPREAD = { min: 1.05, max: 1.45 }

export function forestTree(lng: number, lat: number, i: number, j: number): ObjectInstance {
  const family = cellHash(i, j, 3) < 0.7 ? 'broadleaf' : 'conifer'
  const height = lerp(HEIGHT[family], cellHash(i, j, 4))
  return {
    lng,
    lat,
    height,
    spread: height * lerp(SPREAD, cellHash(i, j, 5)),
    heading: cellHash(i, j, 6) * Math.PI * 2,
    shade: 0.84 + cellHash(i, j, 7) * 0.24,
    tint: cellHash(i, j, 8),
    model: pick(TREE_FAMILIES[family], cellHash(i, j, 9)),
  }
}

export const FOREST_OBJECTS = plantedSpec({
  source: BASEMAP_SOURCE,
  sourceLayer: 'landcover',
  minzoom: 16,
  budget: 6000,
  grid: feature => (feature.properties?.class === 'wood' ? FOREST_GRID : null),
  clear: () => true,
  instance: (_feature, lng, lat, i, j) => forestTree(lng, lat, i, j),
})
