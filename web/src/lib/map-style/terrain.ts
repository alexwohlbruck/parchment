/**
 * The elevation source behind 3D terrain, described once for both engines.
 *
 * Mapterhorn: open terrarium tiles, built from USGS 3DEP lidar (1 m) and 10 m
 * data across the US and Copernicus 30 m elsewhere. Lidar is bare earth, so
 * road embankments and interchanges read in the relief.
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
 * About 2 m a pixel at 512 px. Where a region's data stops lower, the archive
 * answers 404 and the engine keeps drawing the parent tile.
 */
const TERRAIN_MAXZOOM = 15

const TERRAIN_TILE_SIZE = 512

export const TERRAIN_ATTRIBUTION =
  '<a href="https://mapterhorn.com/attribution" target="_blank">© Mapterhorn</a>'

export type TerrainSourceSpec = {
  type: 'raster-dem'
  tiles: string[]
  encoding: 'terrarium'
  tileSize: number
  maxzoom: number
  attribution: string
}

export const TERRAIN_TILES = 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'

/**
 * The same terrain served finer at street zoom, upsampled from the most
 * detailed tiles, so features carved into it (a tunnel's cut) keep their edges.
 */
export const FINE_TERRAIN_PROTOCOL = 'fine-terrain'
export const FINE_TERRAIN_TILES = `${FINE_TERRAIN_PROTOCOL}://{z}/{x}/{y}`
export const FINE_TERRAIN_MAXZOOM = 18

export function terrainSource(fine = false): TerrainSourceSpec {
  return {
    type: 'raster-dem',
    tiles: [fine ? FINE_TERRAIN_TILES : TERRAIN_TILES],
    encoding: 'terrarium',
    tileSize: TERRAIN_TILE_SIZE,
    maxzoom: fine ? FINE_TERRAIN_MAXZOOM : TERRAIN_MAXZOOM,
    attribution: TERRAIN_ATTRIBUTION,
  }
}

/** The tiles a terrain source's template is served from, at their own most detailed zoom. */
export function rawTerrainTiles(template: string, maxzoom: number): { tiles: string; maxzoom: number } {
  return template === FINE_TERRAIN_TILES ? { tiles: TERRAIN_TILES, maxzoom: TERRAIN_MAXZOOM } : { tiles: template, maxzoom }
}
