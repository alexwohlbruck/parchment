/**
 * The elevation source behind 3D terrain, described once for both engines.
 *
 * Mapbox's own DEM (`mapbox://mapbox.terrain-rgb`) is only reachable with a
 * Mapbox token, so it cannot serve the MapLibre engine — which is why terrain
 * has been Mapbox-only, with `setMap3dTerrain` left as a TODO on the MapLibre
 * side.
 *
 * AWS Terrain Tiles is the source that works for both. It is a public dataset
 * on the AWS Open Data registry — SRTM, the USGS National Elevation Dataset and
 * a dozen national surveys, merged and tiled by Mapzen — served without a key
 * or an account, and both engines can read its `terrarium` encoding directly.
 * Same tiles, same numbers, so the two engines render the same hills.
 *
 * Where the data is good it is very good: 10m over the United States, 30m over
 * most of the world. Where it is thin it is thin everywhere equally, which at
 * least makes it predictable.
 *
 * This module is deliberately provider-neutral — it names a source and nothing
 * else. Adding it to a map and turning terrain on is each strategy's job, since
 * the two engines spell that differently.
 */

/** Terrarium packs elevation into RGB as `(r * 256 + g + b / 256) - 32768` metres. */
export const TERRAIN_SOURCE_ID = 'terrain-dem'

/**
 * Vertical scale. 1.0 is life-size, which reads as almost flat at the zooms a
 * street map is used at — the eye expects the exaggeration every 3D map applies.
 * Enough to feel the terrain, not so much that a gentle hill looks like a cliff.
 */
export const TERRAIN_EXAGGERATION = 1.2

/**
 * The dataset stops at zoom 15. Past that the engine over-zooms the last level,
 * which is right: the mesh is already finer than the elevation data behind it.
 */
const TERRAIN_MAXZOOM = 15

/** Terrarium tiles are 256px, not the 512 a DEM source otherwise defaults to. */
const TERRAIN_TILE_SIZE = 256

export const TERRAIN_ATTRIBUTION =
  '<a href="https://registry.opendata.aws/terrain-tiles/" target="_blank">Terrain Tiles</a>'

export type TerrainSourceSpec = {
  type: 'raster-dem'
  tiles: string[]
  encoding: 'terrarium'
  tileSize: number
  maxzoom: number
  attribution: string
}

export function terrainSource(): TerrainSourceSpec {
  return {
    type: 'raster-dem',
    tiles: ['https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png'],
    encoding: 'terrarium',
    tileSize: TERRAIN_TILE_SIZE,
    maxzoom: TERRAIN_MAXZOOM,
    attribution: TERRAIN_ATTRIBUTION,
  }
}
