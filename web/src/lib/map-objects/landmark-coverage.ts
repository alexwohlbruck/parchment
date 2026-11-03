/**
 * What a landmark model covers in plan, for deciding which buildings it hides.
 *
 * A building lying wholly inside a drawn landmark is part of what the model
 * stands in for, and is hidden even when its id does not match `replaces`
 * (see `insideFootprint`). The model's bounding box will not do for that: a
 * roller coaster's is hundreds of metres across and almost all open ground.
 * Fury 325's takes in the whole entrance plaza at Carowinds, and every
 * building standing in it would go flat the moment the model loaded.
 *
 * So the model's real plan is used instead: every triangle, projected onto
 * the ground, burnt into a grid of cells a couple of metres across. A coaster
 * covers a ribbon along its track and a dot per support; a tower covers its
 * whole base. Built once per model as it loads, and read through a
 * summed-area table, so asking whether a stretch of ground is covered is four
 * lookups whatever the tolerance.
 *
 * Engine-neutral, like `landmarks.ts`.
 */
import type { Footprint } from './landmarks'

/** The finest cell, in model metres. Buildings are metres apart; finer buys nothing. */
const CELL_M = 1.5
/** The most cells along either side, so a big model costs at most this squared. */
const MAX_CELLS = 256

/** A model's plan coverage, in its own metres: glTF x east, z south. */
export type Coverage = {
  /** The plan bounding box; nothing beyond it, plus tolerance, is inside. */
  bounds: Footprint
  /** Cell size, and how many there are each way from (bounds.minX, bounds.minZ). */
  cell: number
  cols: number
  rows: number
  /** Covered cells, summed: entry (i, j) counts the covered cells in columns < i and rows < j. */
  sums: Int32Array
}

type Primitive = {
  position: Float32Array
  index: Uint16Array | Uint32Array
  /** The moving node it is drawn with, or -1; its vertices are in that node's frame. */
  node: number
}

/**
 * Burn a model's triangles, projected to plan, into a coverage grid.
 *
 * `pose` places the moving parts: their vertices are in their node's frame,
 * so without it a Ferris wheel's cars would land around its origin. The
 * caller passes the rest pose, which is what `bounds` was measured at.
 *
 * A triangle marks every cell its edges pass through, so a wall seen edge-on
 * — a line in plan — still counts, and every cell whose centre it covers, so
 * a roof fills in.
 */
export function planCoverage(
  model: { primitives: Primitive[]; min: ArrayLike<number>; max: ArrayLike<number> },
  pose?: Map<number, ArrayLike<number>> | null,
): Coverage {
  const bounds = { minX: model.min[0], maxX: model.max[0], minZ: model.min[2], maxZ: model.max[2] }
  const spanX = Math.max(bounds.maxX - bounds.minX, 0)
  const spanZ = Math.max(bounds.maxZ - bounds.minZ, 0)
  const cell = Math.max(CELL_M, spanX / MAX_CELLS, spanZ / MAX_CELLS)
  const cols = Math.max(1, Math.ceil(spanX / cell))
  const rows = Math.max(1, Math.ceil(spanZ / cell))
  const covered = new Uint8Array(cols * rows)

  const col = (x: number) => Math.min(cols - 1, Math.max(0, Math.floor((x - bounds.minX) / cell)))
  const row = (z: number) => Math.min(rows - 1, Math.max(0, Math.floor((z - bounds.minZ) / cell)))
  const mark = (x: number, z: number) => { covered[row(z) * cols + col(x)] = 1 }
  // Steps of half a cell can step over the corner of a cell, never across one.
  const edge = (ax: number, az: number, bx: number, bz: number) => {
    const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / (cell / 2))
    for (let s = 0; s <= steps; s++) mark(ax + ((bx - ax) * s) / (steps || 1), az + ((bz - az) * s) / (steps || 1))
  }

  for (const p of model.primitives) {
    const m = p.node >= 0 ? pose?.get(p.node) : undefined
    const n = p.position.length / 3
    // Plan x and z per vertex, through the node's matrix (column-major) when it moves.
    const xs = new Float32Array(n)
    const zs = new Float32Array(n)
    for (let v = 0; v < n; v++) {
      const [x, y, z] = [p.position[v * 3], p.position[v * 3 + 1], p.position[v * 3 + 2]]
      xs[v] = m ? m[0] * x + m[4] * y + m[8] * z + m[12] : x
      zs[v] = m ? m[2] * x + m[6] * y + m[10] * z + m[14] : z
    }
    for (let t = 0; t + 2 < p.index.length; t += 3) {
      const [a, b, c] = [p.index[t], p.index[t + 1], p.index[t + 2]]
      edge(xs[a], zs[a], xs[b], zs[b])
      edge(xs[b], zs[b], xs[c], zs[c])
      edge(xs[c], zs[c], xs[a], zs[a])
      // The interior, by cell centre. Edge-on triangles have none, and most
      // are too small to hold a centre the edges have not already marked.
      const area = (xs[b] - xs[a]) * (zs[c] - zs[a]) - (zs[b] - zs[a]) * (xs[c] - xs[a])
      if (Math.abs(area) < cell * cell) continue
      const [i0, i1] = [col(Math.min(xs[a], xs[b], xs[c])), col(Math.max(xs[a], xs[b], xs[c]))]
      const [j0, j1] = [row(Math.min(zs[a], zs[b], zs[c])), row(Math.max(zs[a], zs[b], zs[c]))]
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const x = bounds.minX + (i + 0.5) * cell
          const z = bounds.minZ + (j + 0.5) * cell
          // Same side of all three edges as the triangle's winding.
          const e0 = (xs[b] - xs[a]) * (z - zs[a]) - (zs[b] - zs[a]) * (x - xs[a])
          const e1 = (xs[c] - xs[b]) * (z - zs[b]) - (zs[c] - zs[b]) * (x - xs[b])
          const e2 = (xs[a] - xs[c]) * (z - zs[c]) - (zs[a] - zs[c]) * (x - xs[c])
          if (area > 0 ? e0 >= 0 && e1 >= 0 && e2 >= 0 : e0 <= 0 && e1 <= 0 && e2 <= 0) covered[j * cols + i] = 1
        }
    }
  }

  const sums = new Int32Array((cols + 1) * (rows + 1))
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++)
      sums[(j + 1) * (cols + 1) + i + 1] = covered[j * cols + i]
        + sums[j * (cols + 1) + i + 1] + sums[(j + 1) * (cols + 1) + i] - sums[j * (cols + 1) + i]
  return { bounds, cell, cols, rows, sums }
}

/** Whether any covered cell lies within `tol` of a plan point, in model metres. */
export function coveredNear(coverage: Coverage, x: number, z: number, tol: number): boolean {
  const { bounds, cell, cols, rows, sums } = coverage
  // The box test first: it is what the coverage refines, never widens.
  if (x < bounds.minX - tol || x > bounds.maxX + tol || z < bounds.minZ - tol || z > bounds.maxZ + tol) return false
  const i0 = Math.max(0, Math.floor((x - tol - bounds.minX) / cell))
  const i1 = Math.min(cols - 1, Math.floor((x + tol - bounds.minX) / cell))
  const j0 = Math.max(0, Math.floor((z - tol - bounds.minZ) / cell))
  const j1 = Math.min(rows - 1, Math.floor((z + tol - bounds.minZ) / cell))
  if (i0 > i1 || j0 > j1) return false
  const w = cols + 1
  return sums[(j1 + 1) * w + i1 + 1] - sums[j0 * w + i1 + 1] - sums[(j1 + 1) * w + i0] + sums[j0 * w + i0] > 0
}
