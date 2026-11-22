/**
 * How a landmark's model meets the map's terrain: as one rigid body, never
 * bent to it. Models are built for the ground they stand on, so the map moves
 * each one up or down whole and leaves its shape alone.
 *
 * Barrelman's frame puts a model's origin at the lowest ground under it, and
 * for most models that is all: the base is flat at y = 0 and goes on the
 * lowest ground, and uphill the terrain covers the foot of the walls.
 *
 * Some models carry their ground with them. A coaster or a bridge is built
 * over the terrain it stands on, every support running down to the DEM at
 * its own foot. Such a model is moved by the one offset that sets that
 * ground on the map's (see `groundModel`). Its ground is not written down
 * anywhere, so it is found: its lowest vertices stand at a steady depth under
 * the DEM the map draws, where a flat model's stand at a steady height. See
 * `modelGround`.
 *
 * The map fills the ground under a flat model (see `map-terrain/fill.ts`),
 * taking out what the lidar kept that the model draws itself. Not under one
 * built on the DEM: that ground is what its feet were built to.
 */
import type { Footprint } from './landmarks'

/** A point in a model's own frame: x east, y up, z south. */
export type Contact = [x: number, y: number, z: number]

/**
 * The ground a model was built on, in its own units: flat at y = 0, or the
 * terrain itself, `offset` from the raw (unexaggerated) DEM at every point.
 */
export type ModelGround = { follows: false } | { follows: true; offset: number }

/** Cells per side of the plan grid the lowest vertices are looked for on. */
const CONTACT_CELLS = 48

/** Smallest cell, model units: finer only splits one footing into several. */
const CONTACT_CELL_MIN = 2

/** At most this many points are read off the DEM per landmark. */
export const MAX_CONTACTS = 256

/**
 * Metres within which a model's feet count as standing at one depth. The
 * terrain a model was built on and the one the map draws are the same
 * dataset, but not sampled alike — Barrelman's kit reads it on a 20 m grid,
 * the map at its native ~4 m — and at the Carowinds coasters the two differ
 * by up to a metre either way.
 */
const CONTACT_BAND = 1

/**
 * How many more feet the terrain reading has to line up than the flat one
 * before a model is taken to follow it. On a flat site both line up the
 * same feet, and the flat reading — the frame Barrelman documents — stands.
 */
const FOLLOW_MARGIN = 1.25

/** Fewer than this many feet on the terrain is no evidence either way. */
const MIN_CONTACTS = 8

/**
 * Share of the lined-up feet at one height past which they are a floor, not
 * feet. A coaster's footings stand at every height up the slope, and at the
 * Carowinds coasters no one height holds even a quarter of them; a
 * building's lowest vertices are its floors, each dead level, and of the
 * buildings the terrain reading lines up, every one has 30% or more of them
 * on one floor.
 */
const FLOOR_SHARE = 0.3

/** Metres within which a model's vertices count as one level: a floor's. */
const LEVEL = 0.05

/**
 * Where in the band of feet the model's ground is put. High in it, so most
 * feet end at or below the map's ground: a foot set into the ground is
 * hidden, and one standing off it is the bug this module exists to fix.
 */
const GROUND_QUANTILE = 0.8

/**
 * The lowest vertex in each cell of a plan grid over the model: everywhere
 * it could touch the ground. Most are not — the underside of a track, the
 * bottom of a roof — and `modelGround` sorts them out.
 *
 * Moving parts are left out: they are drawn where their node puts them, and
 * none of them stands on the ground.
 */
export function groundContacts(
  primitives: ReadonlyArray<{ position: ArrayLike<number>; node: number }>,
  footprint: Footprint,
): Contact[] {
  const { minX, maxX, minZ, maxZ } = footprint
  const size = Math.max(CONTACT_CELL_MIN, (maxX - minX) / CONTACT_CELLS, (maxZ - minZ) / CONTACT_CELLS)
  const cols = Math.floor((maxX - minX) / size) + 1
  const lowest = new Map<number, Contact>()
  for (const { position: a, node } of primitives) {
    if (node >= 0) continue
    for (let i = 0; i + 2 < a.length; i += 3) {
      const key = Math.floor((a[i + 2] - minZ) / size) * cols + Math.floor((a[i] - minX) / size)
      const known = lowest.get(key)
      if (!known || a[i + 1] < known[1]) lowest.set(key, [a[i], a[i + 1], a[i + 2]])
    }
  }
  const all = [...lowest.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c)
  if (all.length <= MAX_CONTACTS) return all
  // Evenly through the grid, so a big model is read all over.
  const step = all.length / MAX_CONTACTS
  return Array.from({ length: MAX_CONTACTS }, (_, i) => all[Math.floor(i * step)])
}

/**
 * Share of the lowest contacts set aside as below any ground: a tunnel, a
 * basement, a footing sunk deeper than the rest.
 */
const BURIED = 0.05

/**
 * Which ground a model was built on, from its contacts and the raw DEM height
 * in metres under each (NaN where it has not loaded).
 *
 * Each reading puts every contact at some height over its ground: y itself
 * for a flat model, y less the DEM for one that follows the terrain. Under
 * the right reading the feet are the lowest things in the model and all at
 * one depth, with everything else — track, roofs — scattered above them. Under
 * the wrong one the feet spread out over the slope, and only the few at one
 * end of it are at the bottom. So the reading with more contacts in a band at
 * the bottom is the model's.
 *
 * Except where that band is a floor. A flat building on a site with a level
 * plateau — a podium on a hillside, a ground floor raised over a lidar bump
 * — has its floor there at a steady depth under the DEM too, and since the
 * buried share set aside can take most of its base at y = 0, the floor can
 * outnumber it. That only shows the ground under the floor is level, which
 * any building's is. A building truly built over the terrain shows more: it
 * keeps Barrelman's frame, its origin on the lowest ground under it, so the
 * terrain reading puts that ground at y = 0, within a band. One that lines
 * up a floor and puts the lowest ground metres from y = 0 — 9 m below it at
 * 1201 Third Avenue in Seattle, whose base steps down a hill — is flat. A
 * coaster built by Barrelman's kit over a coarser DEM than the map's can be
 * metres off there, but its feet are never a floor.
 */
export function modelGround(contacts: readonly Contact[], raw: readonly number[], scale: number): ModelGround {
  const flat: number[] = []
  const terrain: Array<{ y: number; at: number }> = []
  let lowest = Infinity
  contacts.forEach(([, y], i) => {
    if (!Number.isFinite(raw[i])) return
    flat.push(y)
    terrain.push({ y, at: y - raw[i] / scale })
    lowest = Math.min(lowest, raw[i] / scale)
  })
  const band = CONTACT_BAND / scale
  const onFlat = bottom(flat, band, y => y)
  const onTerrain = bottom(terrain, band, c => c.at)
  if (onTerrain.length < MIN_CONTACTS || onTerrain.length < onFlat.length * FOLLOW_MARGIN) return { follows: false }
  const offset = onTerrain[Math.min(onTerrain.length - 1, Math.floor(onTerrain.length * GROUND_QUANTILE))].at
  // Where the terrain reading puts the lowest ground under the model, in its own frame.
  const origin = lowest + offset
  const floor = onLevel(onTerrain.map(c => c.y), LEVEL / scale) >= onTerrain.length * FLOOR_SHARE
  if (floor && Math.abs(origin) > band) return { follows: false }
  return { follows: true, offset }
}

/** The items in the band `width` wide at the bottom of a set by `value`, past its BURIED share; sorted. */
function bottom<T>(items: readonly T[], width: number, value: (item: T) => number): T[] {
  const v = [...items].sort((a, b) => value(a) - value(b))
  const from = Math.floor(v.length * BURIED)
  let to = from
  while (to < v.length && value(v[to]) - value(v[from]) <= width) to++
  return v.slice(from, to)
}

/** The most of a set of heights that stand within `width` of each other: its biggest level. */
function onLevel(heights: readonly number[], width: number): number {
  const v = [...heights].sort((a, b) => a - b)
  let most = 0
  for (let i = 0, j = 0; i < v.length; i++) {
    while (v[i] - v[j] > width) j++
    most = Math.max(most, i - j + 1)
  }
  return most
}

/**
 * A model set on the map's ground as one rigid body: `lowest`, the lowest
 * drawn ground under it, in map metres, which its origin goes on; `offset`,
 * the one shift in model units that then puts its own ground on the map's;
 * and `ground`, per grid point, the drawn ground over the placed origin in
 * model units, for contact shading.
 *
 * `heights` are the map's as the terrain draws them, exaggerated; a 0 among
 * real ones is a tile that has not loaded and reads as the lowest ground.
 * `under` is the drawn ground at the model's contacts, where it stands: the
 * lowest ground is read there, so a ditch in a corner of its bounding box
 * does not sink it (from the grid until they have loaded). `raw` is the bare
 * DEM in true metres at the grid, NaN where unknown. A flat model's
 * offset is 0. One that follows the terrain takes the median, over the grid,
 * of the map's ground less its own, so its feet meet the terrain wherever
 * the two agree; under exaggeration the hills grow and the model does not.
 */
export function groundModel(
  heights: readonly number[],
  exaggeration: number,
  model: ModelGround,
  scale: number,
  sink: number,
  raw: readonly number[] = [],
  under: readonly number[] = [],
): { lowest: number; offset: number; ground: Float32Array<ArrayBuffer> } {
  const loaded = heights.some(h => h !== 0)
  const stands = under.filter(h => h !== 0)
  const lowest = stands.length ? Math.min(...stands) : Math.min(...(loaded ? heights.filter(h => h !== 0) : heights))
  const drawn = heights.map(h => (loaded && h === 0 ? lowest : h))
  const offset = model.follows && loaded
    ? median(heights.flatMap((h, i) => {
      if (h === 0) return []
      const built = Number.isFinite(raw[i]) ? raw[i] : h / exaggeration
      return [(h - lowest - built) / scale - model.offset]
    }))
    : 0
  const ground = new Float32Array(drawn.map(h => (h - lowest + sink) / scale - offset))
  return { lowest, offset, ground }
}

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b)
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

/**
 * Metres a flat model is pushed under the terrain, whole. The terrain is
 * read on a coarse grid and drawn as a finer mesh, so it can dip a little
 * under the lowest point read; a base over the dip shows daylight. A model
 * that follows the terrain is not pushed: its feet are already in the ground,
 * and a bridge's deck meets the map's roads.
 */
export const GROUND_SINK = 0.3

export function groundSink(model: ModelGround, terrain: boolean): number {
  return terrain && !model.follows ? GROUND_SINK : 0
}

/** Metres: a floor this far down never clips anything. */
const NO_FLOOR = 1e6

/**
 * What a placement's elevation changes, the model having moved up or down
 * with it as a whole: `groundAt`, in model units over its own ground, is the
 * street a sunk model meets, for its contact shading; and `floor`, in map
 * metres up from the anchor, is the flat map's ground with the terrain off,
 * under which nothing is drawn. With the terrain on, its own depth hides
 * what is under it.
 */
export type ElevationGround = { groundAt: number; floor: number }

export function elevationGround(elevation: number, scale: number, terrain: boolean): ElevationGround {
  return {
    groundAt: Math.max(-elevation, 0) / scale,
    floor: terrain ? -NO_FLOOR : -elevation,
  }
}
