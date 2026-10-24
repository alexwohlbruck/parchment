import { boundsOf, mercator, type Bounds } from '../decks'
import { BRIDGE_MESH_FILE } from './mesh-file'

/** The one zoom deck indexes are cut at. */
export const INDEX_ZOOM = 14
/** More index tiles than this means the view is too far out for decks. */
const MAX_TILES = 36
/** Metres a deck's bounds are grown by, as for the decks the detail tiles list. */
const PAD = 100

/** Barrelman's index of a tile, `{ decks: [[file, west, south, east, north], ...] }`, as each mesh file and its deck's padded mercator bounds. */
export function parseIndex(json: unknown): Array<{ file: string; bounds: Bounds }> {
  const decks = (json as { decks?: unknown })?.decks
  if (!Array.isArray(decks)) throw new Error('Invalid bridge deck index')
  return decks.flatMap(entry => {
    if (!Array.isArray(entry) || entry.length !== 5) return []
    const [file, w, s, e, n] = entry
    if (typeof file !== 'string' || !BRIDGE_MESH_FILE.test(file) || ![w, s, e, n].every(Number.isFinite)) return []
    return [{ file, bounds: boundsOf([mercator([w, n]), mercator([e, s])], PAD) }]
  })
}

/** The index tiles, as `x/y` at INDEX_ZOOM, that mercator bounds meet; none when there would be too many. */
export function indexTiles({ minX, minY, maxX, maxY }: Bounds): string[] {
  const n = 2 ** INDEX_ZOOM
  const clamp = (v: number) => Math.min(n - 1, Math.max(0, Math.floor(v * n)))
  const [x0, x1, y0, y1] = [clamp(minX), clamp(maxX), clamp(minY), clamp(maxY)]
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_TILES) return []
  const tiles: string[] = []
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) tiles.push(`${x}/${y}`)
  return tiles
}
