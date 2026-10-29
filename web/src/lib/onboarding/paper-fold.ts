export type FoldAxis = 'x' | 'y'

export interface Crease {
  axis: FoldAxis
  at: number
  hinge: number
}

export interface FoldPlan {
  width: number
  height: number
  cols: number
  rows: number
  creases: Crease[]
}

const MAX_FOLDS = 8

/** Halve the longer side until the folded packet fits `packet`, like folding a road map. */
export function planFolds(width: number, height: number, packet: number, thickness: number): FoldPlan {
  const creases: Crease[] = []
  let w = width
  let h = height
  while (creases.length < 2 || (Math.max(w, h) > packet && creases.length < MAX_FOLDS)) {
    const axis: FoldAxis = w >= h ? 'x' : 'y'
    const at = (axis === 'x' ? w : h) / 2
    if (axis === 'x') w = at
    else h = at
    creases.push({ axis, at, hinge: (2 ** creases.length - 0.5) * thickness })
  }
  const cols = 2 ** creases.filter(c => c.axis === 'x').length
  return { width, height, cols, rows: 2 ** creases.length / cols, creases }
}

/** The panel left on top of the folded packet, showing its back. */
export function coverCell(plan: FoldPlan) {
  const w = plan.width / plan.cols
  const h = plan.height / plan.rows
  const axis = plan.creases[plan.creases.length - 1].axis
  return { x: axis === 'x' ? w : 0, y: axis === 'y' ? h : 0, width: w, height: h, mirror: axis }
}

/**
 * Folds one rigid panel's points (flat x, y, z triples, in place). `angles[i]` is π while
 * crease i is folded and 0 once open; the first point decides which side of each crease
 * the panel is on. `bend` lets a swinging flap's tip lag behind its hinge.
 */
export function foldPanel(points: Float32Array, creases: Crease[], angles: number[], bend: number) {
  for (let i = 0; i < creases.length; i++) {
    const theta = angles[i]
    if (theta <= 0) continue
    const { axis, at, hinge } = creases[i]
    const k = axis === 'x' ? 0 : 1
    if (points[k] <= at) continue

    const curl = bend * Math.sin(theta)
    for (let p = 0; p < points.length; p += 3) {
      const s = points[p + k] - at
      const offset = points[p + 2] - hinge
      const alpha = theta + (curl * s) / at
      let along: number
      let rise: number
      if (Math.abs(curl) < 1e-4) {
        along = s * Math.cos(theta)
        rise = s * Math.sin(theta)
      } else {
        along = (at / curl) * (Math.sin(alpha) - Math.sin(theta))
        rise = (at / curl) * (Math.cos(theta) - Math.cos(alpha))
      }
      points[p + k] = at + along - offset * Math.sin(alpha)
      points[p + 2] = hinge + rise + offset * Math.cos(alpha)
    }
  }
}
