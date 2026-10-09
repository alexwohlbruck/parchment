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
 * steady height. Whichever reading lines more of them up wins.
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
 */
export function modelGround(contacts: readonly Contact[], raw: readonly number[], scale: number): ModelGround {
  const flat: number[] = []
  const terrain: number[] = []
  contacts.forEach(([, y], i) => {
    if (!Number.isFinite(raw[i])) return
    flat.push(y)
    terrain.push(y - raw[i] / scale)
  })
  const band = CONTACT_BAND / scale
  const onFlat = bottom(flat, band)
  const onTerrain = bottom(terrain, band)
  if (onTerrain.length < MIN_CONTACTS || onTerrain.length < onFlat.length * FOLLOW_MARGIN) return { follows: false }
  return { follows: true, offset: onTerrain[Math.min(onTerrain.length - 1, Math.floor(onTerrain.length * GROUND_QUANTILE))] }
}

/** The values in the band `width` wide at the bottom of a set, past its BURIED share; sorted. */
function bottom(values: readonly number[], width: number): number[] {
  const v = [...values].sort((a, b) => a - b)
  const from = Math.floor(v.length * BURIED)
  let to = from
  while (to < v.length && v[to] - v[from] <= width) to++
  return v.slice(from, to)
}

/**
 * The ground under a placed model, for the vertex shader: per sample, the
 * map's rise above the lowest point and the model's own ground, interleaved,
 * in model units; their mean difference, which is what the model above the
 * blend is lifted by; and the lowest point itself, which the base is set on.
 *
 * `heights` are the map's, exaggerated, as the terrain draws them. A 0 among
 * real heights is a tile that has not loaded, not the sea, and is read as the
 * lowest ground. A model that follows the terrain follows the raw DEM, which
 * is what it was built on; the exaggeration's extra rise is taken up by the
 * drape, so its supports stretch to meet the taller hills.
 */
export function groundLifts(
  heights: readonly number[],
  exaggeration: number,
  model: ModelGround,
  scale: number,
): { lifts: Float32Array<ArrayBuffer>; mean: number; lowest: number } {
  const loaded = heights.some(h => h !== 0)
  const known = loaded ? heights.filter(h => h !== 0) : [...heights]
  const lowest = Math.min(...known)
  // With no terrain loaded at all, the map is flat for now, whatever the model.
  const offset = model.follows && loaded ? model.offset : null
  const lifts = new Float32Array(heights.length * 2)
  let sum = 0
  heights.forEach((h, i) => {
    const at = loaded && h === 0 ? lowest : h
    const rise = (at - lowest) / scale
    const own = offset === null ? 0 : at / exaggeration / scale + offset
    lifts[i * 2] = rise
    lifts[i * 2 + 1] = own
    sum += rise - own
  })
  return { lifts, mean: heights.length ? sum / heights.length : 0, lowest }
}
