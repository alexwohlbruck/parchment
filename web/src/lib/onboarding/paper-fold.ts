export type FoldAxis = 'x' | 'y'

export interface Crease {
  axis: FoldAxis
  /** Crease position in the packet's coordinates when this fold is made; also the packet's new extent. */
  at: number
  /** The packet's extent along `axis` before this fold. */
  extent: number
  hinge: number
}

export interface FoldPlan {
  width: number
  height: number
  /** Packet size once fully folded. */
  packet: { width: number; height: number }
  creases: Crease[]
  /** Panel boundaries in flat sheet coordinates, including both edges. */
  lines: { x: number[]; y: number[] }
}

const MIN_FOLD_RATIO = 1.25
const MAX_FOLDS = 6

/** Geometric fold positions that land exactly on `packet`; every flap is no longer than what it folds onto. */
function axisFolds(extent: number, packet: number, count: number) {
  const ratio = (packet / extent) ** (1 / count)
  return Array.from({ length: count }, (_, i) => extent * ratio ** (i + 1))
}

function axisPlan(extent: number, packet: number) {
  const ratio = extent / packet
  const count = ratio < MIN_FOLD_RATIO ? 0 : Math.ceil(Math.log2(ratio))
  return { count, packet: count ? packet : extent, halves: false }
}

/** Flat-sheet positions that packet coordinate `v` came from, through folds `0..upTo` on one axis. */
function preimages(v: number, ats: number[], extents: number[], upTo: number): number[] {
  if (upTo < 0) return [v]
  const at = ats[upTo]
  const out = preimages(v, ats, extents, upTo - 1)
  const mirrored = 2 * at - v
  if (mirrored > at && mirrored <= extents[upTo] + 1e-6) out.push(...preimages(mirrored, ats, extents, upTo - 1))
  return out
}

function axisLines(extent: number, ats: number[]) {
  const extents = [extent, ...ats.slice(0, -1)]
  const lines = new Set([0, extent])
  ats.forEach((at, i) => preimages(at, ats, extents, i - 1).forEach(v => lines.add(Math.round(v * 1000) / 1000)))
  return [...lines].sort((a, b) => a - b)
}

/**
 * Fold a `width` × `height` sheet down to a `packetWidth` × `packetHeight` packet, like a road map:
 * always fold whichever remaining side is longer. Sides already close to the packet size stay
 * unfolded, and at least two folds are made, halving when the packet is the whole sheet.
 */
export function planFolds(width: number, height: number, packetWidth: number, packetHeight: number, thickness: number): FoldPlan {
  const x = axisPlan(width, packetWidth)
  const y = axisPlan(height, packetHeight)
  while (x.count + y.count < 2) {
    const axis = x.count < y.count || (x.count === y.count && width / 2 ** x.count >= height / 2 ** y.count) ? x : y
    axis.count++
    axis.halves = true
  }
  while (x.count + y.count > MAX_FOLDS) (x.count >= y.count ? x : y).count--
  if (x.halves) x.packet = width / 2 ** x.count
  if (y.halves) y.packet = height / 2 ** y.count

  const xs = axisFolds(width, x.packet, x.count)
  const ys = axisFolds(height, y.packet, y.count)
  const creases: Crease[] = []
  let w = width
  let h = height
  let i = 0
  let j = 0
  while (i < xs.length || j < ys.length) {
    const axis: FoldAxis = j >= ys.length || (i < xs.length && w >= h) ? 'x' : 'y'
    const hinge = (2 ** creases.length - 0.5) * thickness
    if (axis === 'x') {
      creases.push({ axis, at: xs[i], extent: w, hinge })
      w = xs[i++]
    } else {
      creases.push({ axis, at: ys[j], extent: h, hinge })
      h = ys[j++]
    }
  }
  return {
    width,
    height,
    packet: { width: w, height: h },
    creases,
    lines: { x: axisLines(width, xs), y: axisLines(height, ys) },
  }
}

/**
 * Folds one rigid panel's points (flat x, y, z triples, in place). `angles[i]` is π while
 * crease i is folded and 0 once open; the first point decides which side of each crease
 * the panel is on. `bend` lets a swinging flap's tip lag behind its hinge.
 */
export function foldPanel(points: Float32Array, creases: Crease[], angles: number[], bend: number) {
  for (let i = 0; i < creases.length; i++) {
    const theta = angles[i]
    if (theta === 0) continue
    const { axis, at, extent, hinge } = creases[i]
    const k = axis === 'x' ? 0 : 1
    if (points[k] <= at) continue

    const length = extent - at
    const curl = bend * Math.sin(theta)
    for (let p = 0; p < points.length; p += 3) {
      const s = points[p + k] - at
      const offset = points[p + 2] - hinge
      const alpha = theta + (curl * s) / length
      let along: number
      let rise: number
      if (Math.abs(curl) < 1e-4) {
        along = s * Math.cos(theta)
        rise = s * Math.sin(theta)
      } else {
        along = (length / curl) * (Math.sin(alpha) - Math.sin(theta))
        rise = (length / curl) * (Math.cos(theta) - Math.cos(alpha))
      }
      points[p + k] = at + along - offset * Math.sin(alpha)
      points[p + 2] = hinge + rise + offset * Math.cos(alpha)
    }
  }
}

/** The panel left on top of the folded packet, and whether its back reads mirrored from above. */
export function coverPanel(plan: FoldPlan) {
  const folded = plan.creases.map(() => Math.PI)
  let best = { x: 0, y: 0, width: 0, height: 0, z: -Infinity, mirror: { x: false, y: false } }
  for (let r = 0; r < plan.lines.y.length - 1; r++) {
    for (let c = 0; c < plan.lines.x.length - 1; c++) {
      const [x0, x1, y0, y1] = [plan.lines.x[c], plan.lines.x[c + 1], plan.lines.y[r], plan.lines.y[r + 1]]
      const points = new Float32Array([(x0 + x1) / 2, (y0 + y1) / 2, 0, x0, y0, 0, x1, y1, 0])
      foldPanel(points, plan.creases, folded, 0)
      if (points[2] > best.z) {
        best = { x: x0, y: y0, width: x1 - x0, height: y1 - y0, z: points[2], mirror: { x: points[3] > points[6], y: points[4] > points[7] } }
      }
    }
  }
  return best
}
