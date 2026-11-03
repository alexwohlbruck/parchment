/**
 * Shapes carved into the terrain's elevation tiles as they load: each
 * owner's set kept apart and carved in rank order, each tile carved once a
 * round, a few a frame. One carver is shared by every layer that carves.
 */
import type { Bounds } from '@/lib/map-decks/decks'
import { carveTile, tileUnder, type Elevation, type Footprint } from './carve'
import { fillTile, type GroundFill } from './fill'

/** Milliseconds a frame may spend carving tiles. */
const CARVE_BUDGET = 16

/** Something carved into the ground: where it reaches, and how it changes a tile there; whether it did. */
export type Carving = { bounds: Bounds; carve: (tile: Elevation, at: [number, number, number]) => boolean }

export const cutCarving = (f: Footprint): Carving => ({ bounds: f.bounds, carve: (tile, at) => carveTile(tile, at, [f]) })

export const fillCarving = (f: GroundFill): Carving => ({ bounds: f.bounds, carve: (tile, at) => fillTile(tile, at, f) })

/**
 * One owner's carvings. `rank` orders owners, lowest first, so a cut lands
 * in ground already filled; `focus` asks for finer terrain under them.
 */
type Owned = { carvings: Map<string, Carving>; rank: number; focus: boolean }

/** A MapLibre DEM tile's pixels, read and written in metres; read straight from its bytes, as `dem.get` looks its view up per pixel. */
function elevation(dem: any): Elevation {
  const bytes = new Uint8Array(dem.data.buffer, dem.data.byteOffset, dem.data.byteLength)
  const stride = dem.dim + 4
  const [red, green, blue, shift] = dem.getUnpackVector()
  const at = (x: number, y: number) => ((y + 2) * stride + x + 2) * 4
  return {
    dim: dem.dim,
    border: 2,
    get: (x, y) => {
      const i = at(x, y)
      return bytes[i] * red + bytes[i + 1] * green + bytes[i + 2] * blue - shift
    },
    set: (x, y, metres) => {
      const { r, g, b } = dem.pack(metres)
      const i = at(x, y)
      bytes[i] = r
      bytes[i + 1] = g
      bytes[i + 2] = b
      dem.min = Math.min(dem.min, metres)
    },
  }
}

/** Whether `a` spans `b`, give or take `slack` in mercator units. */
const covers = (a: Bounds, b: Bounds, slack = 0) =>
  a.minX <= b.minX + slack && a.minY <= b.minY + slack && a.maxX >= b.maxX - slack && a.maxY >= b.maxY - slack

/** A few centimetres in mercator units: a pad's reach, turned from metres at its outline's first point, shifts by about this as the outline grows. */
const BOUNDS_SLACK = 1e-9

function prepared(tile: any) {
  tile.needsTerrainPrepare = true
  tile.needsHillshadePrepare = true
}

export class TerrainCarver {
  private owners = new Map<string, Owned>()
  private ordered: Carving[] = []
  /** The round of carving each elevation tile has had; a tile behind the current round is carved again. */
  private carved = new WeakMap<object, number>()
  private rounds = 0
  /** Tiles that arrived since their last carving, whose neighbours hold their uncarved edge. */
  private arrived = new WeakSet<object>()
  /** Carvings the last round only added on top of the one before, so a tile carved then needs just these. */
  private topping: { from: number; carvings: Carving[] } | null = null

  /** `focus` is told, per owner that asks, where it carves, so finer terrain is served there. */
  constructor(private map: () => any, private focus?: (areas: Bounds[], owner: string) => void) {}

  get size() {
    return this.ordered.length
  }

  /** Bumped with every new set of carvings. */
  get round() {
    return this.rounds
  }

  /**
   * Take on an owner's new set: carved over what is there, or, where one has gone, into freshly loaded ground.
   * `widens` says each carving only ever grows over the one it replaces, so ground a new one spans is carved over rather than reloaded.
   */
  set(owner: string, next: Map<string, Carving>, { rank = 0, focus = false, widens = false } = {}) {
    const had = this.owners.get(owner)?.carvings ?? new Map<string, Carving>()
    if (next.size === had.size && [...next.keys()].every(k => had.has(k))) return
    const removed = [...had]
      .filter(([key]) => !next.has(key))
      .map(([, c]) => c.bounds)
      .filter(b => !widens || ![...next.values()].some(c => covers(c.bounds, b, BOUNDS_SLACK)))
    const others = [...this.owners].filter(([id]) => id !== owner).map(([, o]) => o.rank)
    const added = [...next].filter(([key]) => !had.has(key)).map(([, c]) => c)
    this.topping = others.every(r => r <= rank) ? { from: this.rounds, carvings: added } : null
    if (next.size) this.owners.set(owner, { carvings: next, rank, focus })
    else this.owners.delete(owner)
    this.ordered = [...this.owners.values()].sort((a, b) => a.rank - b.rank).flatMap(o => [...o.carvings.values()])
    this.rounds++
    if (focus) {
      const areas = [...next.values()].map(c => c.bounds)
      const before = [...had.values()].map(c => c.bounds)
      const reached = areas.filter(a => !before.some(b => covers(b, a)))
      this.focus?.(areas, owner)
      this.reload(reached, tile => tile.state === 'errored')
    }
    // Every owner's carving is in the reloaded tiles again by the next frame: they are new tiles.
    this.reload(removed)
  }

  /** Whether an elevation tile has been carved this round. */
  current(dem: object): boolean {
    return this.carved.get(dem) === this.rounds
  }

  /** Mark a tile that arrived to be carved; its neighbours' borders, which MapLibre filled from its raw ground, are copied back from it once it is. */
  recarveAround(loaded: any) {
    if (!loaded.dem) return
    this.carved.delete(loaded.dem)
    this.arrived.add(loaded)
  }

  /** Carve every owner's shapes into each loaded elevation tile not yet carved this round. */
  carveTiles() {
    if (!this.ordered.length) return
    const map = this.map()
    const start = performance.now()
    let changed = false
    for (const tile of this.tiles()) {
      const was = tile.dem && this.carved.get(tile.dem)
      if (!tile.dem || was === this.rounds) continue
      if (performance.now() - start > CARVE_BUDGET) {
        map?.triggerRepaint()
        break
      }
      this.carved.set(tile.dem, this.rounds)
      const { z, x, y } = tile.tileID.canonical
      const at: [number, number, number] = [z, x, y]
      const dem = elevation(tile.dem)
      let carved = false
      const carvings = this.topping && was === this.topping.from ? this.topping.carvings : this.ordered
      for (const c of carvings) if (tileUnder(at, [c.bounds]) && c.carve(dem, at)) carved = true
      if (this.arrived.delete(tile) && carved) this.backfillAround(tile)
      if (!carved) continue
      prepared(tile)
      changed = true
    }
    if (changed) map?.triggerRepaint()
  }

  /** Copy a freshly carved tile's edge into the borders of the loaded tiles beside it. */
  private backfillAround(tile: any) {
    const { z, x, y } = tile.tileID.canonical
    const n = 2 ** z
    for (const other of this.tiles()) {
      const c = other.tileID.canonical
      if (other === tile || !other.dem || c.z !== z || other.dem.dim !== tile.dem.dim) continue
      const dx = ((x - c.x + n + 1) % n) - 1
      const dy = y - c.y
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) continue
      other.dem.backfillBorder(tile.dem, dx, dy)
      prepared(other)
    }
  }

  /** Let go of an owner's carvings, reloading the terrain they changed. */
  clear(owner: string) {
    if (this.owners.get(owner)?.focus) this.focus?.([], owner)
    this.set(owner, new Map())
  }

  tiles(): any[] {
    return this.map()?.terrain?.tileManager?.tileManager?._inViewTiles?.getAllTiles?.() ?? []
  }

  /**
   * Load the elevation tiles under these areas afresh: uncarved where a
   * carving has gone, and finer where one has arrived on a tile that came back
   * empty. Only those tiles, so the rest of the terrain, and the tiles cached off screen, are kept.
   */
  private reload(areas: Bounds[], which: (tile: any) => boolean = () => true) {
    const manager = this.map()?.terrain?.tileManager?.tileManager
    if (!manager || !areas.length) return
    const under = (tile: any) => which(tile) && tileUnder([tile.tileID.canonical.z, tile.tileID.canonical.x, tile.tileID.canonical.y], areas)
    manager._outOfViewCache?.filter((tile: any) => !under(tile))
    manager.refreshTiles(this.tiles().filter(under).map(tile => tile.tileID.canonical))
  }
}
