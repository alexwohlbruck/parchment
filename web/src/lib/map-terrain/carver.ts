/**
 * Footprints carved into the terrain's elevation tiles as they load: one
 * owner's set at a time, each tile carved once a round, a few a frame.
 */
import type { Bounds } from '@/lib/map-decks/decks'
import { carveTile, tileUnder, type Elevation, type Footprint } from './carve'

/** Milliseconds a frame may spend carving tiles. */
const CARVE_BUDGET = 6

/** A MapLibre DEM tile's pixels, read and written in metres. */
function elevation(dem: any): Elevation {
  const bytes = new Uint8Array(dem.data.buffer, dem.data.byteOffset, dem.data.byteLength)
  return {
    dim: dem.dim,
    border: 2,
    get: (x, y) => dem.get(x, y),
    set: (x, y, metres) => {
      const { r, g, b } = dem.pack(metres)
      const i = dem._idx(x, y) * 4
      bytes[i] = r
      bytes[i + 1] = g
      bytes[i + 2] = b
      dem.min = Math.min(dem.min, metres)
    },
  }
}

export class TerrainCarver {
  private carving = new Map<string, Footprint>()
  /** The round of carving each elevation tile has had; a tile behind the current round is carved again. */
  private carved = new WeakMap<object, number>()
  private rounds = 0
  /** Where finer terrain has been asked for. */
  private focused: Bounds[] = []

  /** `focus` is told where footprints are carved, so finer terrain is served there. */
  constructor(private map: () => any, private focus?: (areas: Bounds[]) => void) {}

  get size() {
    return this.carving.size
  }

  /** Bumped with every new set of footprints. */
  get round() {
    return this.rounds
  }

  /** Take on a new set of footprints: carved over what is there, or, where one has gone, into freshly loaded ground. */
  set(next: Map<string, Footprint>) {
    if (next.size === this.carving.size && [...next.keys()].every(k => this.carving.has(k))) return
    const removed = [...this.carving].filter(([key]) => !next.has(key)).map(([, f]) => f.bounds)
    const areas = [...next.values()].map(f => f.bounds)
    const reached = areas.filter(a => !this.focused.some(b => b.minX <= a.minX && b.minY <= a.minY && b.maxX >= a.maxX && b.maxY >= a.maxY))
    this.carving = next
    this.focused = areas
    this.focus?.(areas)
    this.rounds++
    this.reload([...removed, ...reached])
  }

  /** Whether an elevation tile has been carved this round. */
  current(dem: object): boolean {
    return this.carved.get(dem) === this.rounds
  }

  /** Mark a tile and the loaded tiles beside it to be carved again: a tile arriving fills its neighbours' borders from its own uncarved ground. */
  recarveAround(loaded: any) {
    const { z, x, y } = loaded.tileID.canonical
    for (const tile of this.tiles()) {
      const c = tile.tileID.canonical
      if (tile.dem && c.z === z && Math.abs(c.x - x) <= 1 && Math.abs(c.y - y) <= 1) this.carved.delete(tile.dem)
    }
  }

  /** Carve the footprints into each loaded elevation tile not yet carved this round. */
  carveTiles() {
    if (!this.carving.size) return
    const map = this.map()
    const footprints = [...this.carving.values()]
    const start = performance.now()
    let changed = false
    for (const tile of this.tiles()) {
      if (!tile.dem || this.carved.get(tile.dem) === this.rounds) continue
      if (performance.now() - start > CARVE_BUDGET) {
        map?.triggerRepaint()
        break
      }
      this.carved.set(tile.dem, this.rounds)
      const { z, x, y } = tile.tileID.canonical
      if (!carveTile(elevation(tile.dem), [z, x, y], footprints)) continue
      tile.needsTerrainPrepare = true
      tile.needsHillshadePrepare = true
      changed = true
    }
    if (changed) map?.triggerRepaint()
  }

  /** Let go of everything carved, reloading the terrain it changed. */
  clear() {
    this.focus?.([])
    if (this.carving.size) this.map()?.terrain?.tileManager?.tileManager?.reload(true)
    this.carving = new Map()
    this.focused = []
  }

  tiles(): any[] {
    return this.map()?.terrain?.tileManager?.tileManager?._inViewTiles?.getAllTiles?.() ?? []
  }

  /**
   * Load the elevation tiles under these areas afresh: uncarved where a
   * footprint has gone, finer where one has arrived. Only those tiles, so the
   * rest of the terrain, and the tiles cached off screen, are kept.
   */
  private reload(areas: Bounds[]) {
    const manager = this.map()?.terrain?.tileManager?.tileManager
    if (!manager || !areas.length) return
    const under = (tile: any) => tileUnder([tile.tileID.canonical.z, tile.tileID.canonical.x, tile.tileID.canonical.y], areas)
    manager._outOfViewCache?.filter((tile: any) => !under(tile))
    manager.refreshTiles(this.tiles().filter(under).map(tile => tile.tileID.canonical))
  }
}
