/**
 * How a landmark's model meets the map's terrain.
 *
 * Barrelman's frame puts a model's origin at the lowest ground under it, and
 * for most models that is the whole story: the base is flat at y = 0, and the
 * layer drapes it over the terrain — lifting each low vertex by the rise of
 * the ground under it (see GROUND in `landmark-layer.ts`).
 *
 * Some models carry their ground with them. A coaster is built over the
 * terrain it stands on, so every support runs down to the ground at its own
 * bent, and on a slope the feet sit metres apart in the model. Draped as if
 * its base were flat, the slope is counted twice: a foot the model already
 * raised to the top of the slope is raised again by the drape, and ends up
 * its own height above the ground.
 *
 * So the drape works from the model's own ground instead of from y = 0. Each
 * vertex is lifted by the map's ground less the model's under it — fully
 * where it stands on the model's ground, fading to a constant above it — so a
 * foot lands on the map's terrain wherever the model put it, and the track
 * high above stays rigid. For a flat-based model the model's ground is 0, and
 * this is exactly the drape it always had.
 *
 * The model's ground is not written down anywhere, so it is found: a model
 * that follows the terrain has its lowest vertices — its feet, its station
 * floor — at a steady depth under the same DEM the map draws (AWS Terrain
 * Tiles, which Barrelman's kit samples too), and a flat one has them at a
 * steady height. Whichever reading lines more of them up wins, unless the
 * terrain reading has only lined up a floor; see `modelGround`.
 *
 * The map's ground under a landmark is filled (see `map-terrain/fill.ts`),
 * which brings it down where the lidar kept something the model draws. A
 * model that follows the terrain was built on the ground before the fill,
 * so only its feet go down to meet the filled ground; the rest of it stands
 * where it was built. See `groundLifts`.
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

/** Floats per grid point in `groundLifts`: the map's rise, the model's own ground, and the fill's depth. */
export const GROUND_STRIDE = 3

/**
 * The ground under a placed model, for the vertex shader: per sample, the
 * map's rise above the lowest point, the model's own ground, and how far the
 * fill brought the map's ground down from the ground the model was built on,
 * interleaved, in model units; the mean lift, which is what the model above
 * the blend is lifted by; and the lowest point itself, which the base is set
 * on.
 *
 * `heights` are the map's, exaggerated, as the terrain draws them. A 0 among
 * real heights is a tile that has not loaded, not the sea, and is read as the
 * lowest ground. A model that follows the terrain follows the raw DEM, which
 * is what it was built on; the exaggeration's extra rise is taken up by the
 * drape, so its supports stretch to meet the taller hills. `raw` is that DEM
 * in true metres where it differs from the map's, which fills the ground
 * under a landmark (see `map-terrain/fill.ts`): NaN where unknown.
 *
 * The fill matters only to the feet of such a model. Lifted by the filled
 * ground everywhere, a model built on the bare DEM would sink by however
 * much the fill took away — the Lincoln Memorial by 3.6 m, a bridge's low
 * deck where the fill reaches under it — so the mean, and the drape above
 * the feet, are worked out from the bare ground, and the depth the fill
 * took is kept apart for the shader to take off the feet alone, fading out
 * over FILL_FADE above them (see GROUND in `landmark-layer.ts`), so they
 * still meet the ground the map draws. A flat model stands on the filled
 * ground, which is the point of the fill, so its depth is 0 and its drape is
 * what it always was.
 */
export function groundLifts(
  heights: readonly number[],
  exaggeration: number,
  model: ModelGround,
  scale: number,
  raw: readonly number[] = [],
): { lifts: Float32Array<ArrayBuffer>; mean: number; lowest: number } {
  const loaded = heights.some(h => h !== 0)
  const known = loaded ? heights.filter(h => h !== 0) : [...heights]
  const lowest = Math.min(...known)
  // With no terrain loaded at all, the map is flat for now, whatever the model.
  const offset = model.follows && loaded ? model.offset : null
  const lifts = new Float32Array(heights.length * GROUND_STRIDE)
  let sum = 0
  heights.forEach((h, i) => {
    const at = loaded && h === 0 ? lowest : h
    const rise = (at - lowest) / scale
    const bare = Number.isFinite(raw[i])
    const built = bare ? raw[i] : at / exaggeration
    const own = offset === null ? 0 : built / scale + offset
    // Never negative: the fill only ever brings the ground down.
    const filled = offset !== null && bare ? Math.max(0, raw[i] * exaggeration - at) / scale : 0
    lifts[i * GROUND_STRIDE] = rise
    lifts[i * GROUND_STRIDE + 1] = own
    lifts[i * GROUND_STRIDE + 2] = filled
    sum += rise + filled - own
  })
  return { lifts, mean: heights.length ? sum / heights.length : 0, lowest }
}

/**
 * Metres a landmark's base is pushed under the terrain. The terrain is read
 * on a coarse grid and drawn as a finer mesh, so it can dip a little between
 * samples; a base that floats over the dip shows daylight under the
 * building, which is worse than burying its foot. Only the base: a plaza
 * deck or a step above it stays at its true height, and the walls stretch.
 */
export const GROUND_SINK = 0.5

/** Metres above its own ground a vertex still counts as the base, for a flat-based model. */
export const BASE_BAND = 0.05

/**
 * Metres above the base over which a terrain model's feet stop following the
 * fill down (see `groundLifts`). Not a step at the base: the model's own
 * ground is read at only GROUND_GRID² points, so between them a foot can
 * stand a metre or two off it on a steep site — at the Brooklyn Bridge's
 * Brooklyn approach, up to 2.5 m — and a foot taken for something above the
 * base would hang over the filled ground by all the fill took away. Short
 * against GROUND_BLEND all the same, so a bridge's low deck, a terrace or a
 * stair stays where it was built.
 */
export const FILL_FADE = 6

/**
 * How far, in model units, the base is pushed down, how high above the
 * model's own ground a vertex is still base, and how far above that the
 * fill's depth fades out of the drape. A model that follows the terrain has
 * its feet scattered through a band (CONTACT_BAND), so all of them are
 * base. No sink and no base with the terrain off, where the map is flat.
 */
export function baseSink(model: ModelGround, scale: number, terrain: boolean): { depth: number; band: number; fade: number } {
  if (!terrain) return { depth: 0, band: 0, fade: FILL_FADE / scale }
  return { depth: GROUND_SINK / scale, band: (model.follows ? CONTACT_BAND : BASE_BAND) / scale, fade: FILL_FADE / scale }
}

/** Metres: a floor this far down never clips anything. */
const NO_FLOOR = 1e6

/**
 * How a placement's elevation changes the way its model meets the ground.
 *
 * The elevation moves the whole anchor, after the model has been set on the
 * lowest ground under it (see `place` in `landmark-layer.ts`), so the model's
 * own ground stays where it was built and a lift in its geometry is never
 * needed. What changes is the drape:
 *
 *   raised  Nothing of the model touches the ground — it stands on a plinth
 *           or a pier the map doesn't draw — so it is `rigid`: it takes the
 *           mean ground as one block, and no part of it is stretched over
 *           the terrain below.
 *   sunk    Its base is under the street, and the ground it meets is
 *           `groundAt` model metres above its own. The drape is measured
 *           from there, so its street-level walls follow the street the way
 *           a building's base does. Without that, a bowl 30 m deep would be
 *           rigid above the street and never meet it.
 *
 * And `floor`, in map metres up from the anchor: where the flat map's ground
 * is with the terrain off. The flat map writes no depth, so a sunk model
 * would show through it; whatever is below is not drawn. With the terrain on,
 * the terrain's own depth hides what is under it, more exactly than the
 * coarse grid could, so nothing is clipped.
 */
export type ElevationDrape = { rigid: boolean; groundAt: number; floor: number }

export function elevationDrape(elevation: number, scale: number, terrain: boolean): ElevationDrape {
  return {
    rigid: elevation > 0,
    groundAt: Math.max(-elevation, 0) / scale,
    floor: terrain ? -NO_FLOOR : -elevation,
  }
}
