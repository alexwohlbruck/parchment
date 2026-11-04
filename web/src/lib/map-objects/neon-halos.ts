/**
 * The glow around a lit sign at night: one soft card per sign, fitted to it.
 *
 * A sign's pieces are found by connectivity and merged when they face the
 * same way within `NEON_HALO.gap` of each other, so a word of separate letters
 * is one sign but screens round a corner are two. Each is fitted with its
 * principal axes: a flat sign gets a card in its own plane, grown by
 * `margin`; a chunky one (a ball, a drum) a disc that faces the camera. A
 * glow is as strong as the share of its card the sign fills, so a ring of
 * lights is a haze rather than a lit disc.
 */
import type { GlbPrimitive } from './glb.mjs'
import { isNeon, NEON_GLOW } from './landmarks'

type Vec3 = [number, number, number]

export type Halo = {
  /** Model space, metres. */
  centre: Vec3
  /** Half-extent vectors across the card; a disc's radius is `|u|`. */
  u: Vec3
  v: Vec3
  /** sRGB, the sign's colour as it glows. */
  color: Vec3
  /** Metres the glow reaches past the sign's edge. */
  margin: number
  /** 0–1, the share of its card the sign fills. */
  strength: number
  billboard: boolean
}

export const NEON_HALO = {
  /** Metres between pieces that still make one sign. */
  gap: 1.2,
  /** Glow reach as a share of the sign's longer half-extent, within metres [min, max]. */
  reach: 0.3, minReach: 0.8, maxReach: 5,
  /** A sign this deep, as a share of its middle extent, is drawn as a disc. */
  chunky: 0.5,
  /** Pieces whose faces are this close to parallel can be one sign: cos 30°. */
  parallel: 0.866,
  /** A flat piece whose area seen square on is under this share of all of it is bent, and split. */
  planar: 0.85,
  /** Metres across under which a piece is too small to glow. */
  smallest: 0.6,
  /** Square metres of lit card, its area times its strength, under which a glow is left out. */
  faint: 1,
  opacity: 0.4,
}

/** More than any model has signs; the rest, smallest first, go without. */
export const MAX_HALOS = 64

/** Floats per halo in `packHalos`: centre, u, v, colour, margin, strength, billboard. */
export const HALO_FLOATS = 15

/** Triangles of one primitive, by the offset of their first index. */
type Piece = { tris: number[]; min: Vec3; max: Vec3; shape: Shape }
type Axis = { axis: Vec3; mid: number; half: number }
/** Principal axes, longest first, around `mean`. */
type Shape = { mean: Vec3; axes: Axis[]; flat: boolean }

/** A sign's colour as it glows: its own linear colour raised, as the draw shader's neon. */
export function neonGlowColor(linear: ArrayLike<number>): Vec3 {
  return [0, 1, 2].map(i => Math.pow(Math.min(1, linear[i] * NEON_GLOW.gain + NEON_GLOW.lift), 1 / 2.2)) as Vec3
}

/** A quarter of a card's area, square metres. */
const size = (h: Halo) => Math.hypot(...h.u) * Math.max(Math.hypot(...h.v), 0.1)

export function neonHalos(primitives: GlbPrimitive[]): Halo[] {
  const halos: Halo[] = []
  for (const p of primitives) {
    // A moving part's vertices are in its node's frame, which the halo does not follow.
    if (!isNeon(p.material) || p.node >= 0) continue
    const color = neonGlowColor(p.color)
    const all = Array.from({ length: p.index.length / 3 }, (_, i) => i * 3)
    for (const piece of merge(p, pieces(p, all).flatMap(piece => planar(p, piece) ? [piece] : split(p, piece)))) {
      const halo = fit(p, piece, color)
      if (halo && 4 * size(halo) * halo.strength >= NEON_HALO.faint) halos.push(halo)
    }
  }
  return halos.sort((a, b) => size(b) - size(a)).slice(0, MAX_HALOS)
}

export function packHalos(halos: Halo[]): Float32Array {
  const out = new Float32Array(halos.length * HALO_FLOATS)
  halos.forEach((h, i) => out.set([...h.centre, ...h.u, ...h.v, ...h.color, h.margin, h.strength, h.billboard ? 1 : 0], i * HALO_FLOATS))
  return out
}

/** Connected pieces of some of a primitive's triangles, joined where they share a vertex position. */
function pieces(p: GlbPrimitive, tris: number[]): Piece[] {
  const { position, index } = p
  const ids = new Map<string, number>()
  const idOf = (i: number) => {
    const key = `${Math.round(position[i * 3] * 100)},${Math.round(position[i * 3 + 1] * 100)},${Math.round(position[i * 3 + 2] * 100)}`
    let id = ids.get(key)
    if (id === undefined) ids.set(key, (id = ids.size))
    return id
  }
  const vertexIds = tris.map(t => [idOf(index[t]), idOf(index[t + 1]), idOf(index[t + 2])])
  const parent = Int32Array.from({ length: ids.size }, (_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]]
    return i
  }
  for (const [a, b, c] of vertexIds) {
    parent[find(b)] = find(a)
    parent[find(c)] = find(a)
  }
  const byRoot = new Map<number, number[]>()
  tris.forEach((t, i) => {
    const root = find(vertexIds[i][0])
    const group = byRoot.get(root)
    if (group) group.push(t)
    else byRoot.set(root, [t])
  })
  return [...byRoot.values()].flatMap(group => piece(p, group) ?? [])
}

/** Whether a piece is round enough for a disc, or flat enough that its card faces what it is made of. */
function planar(p: GlbPrimitive, piece: Piece): boolean {
  // Deep but made of one or two directions of face, it is panels meeting at an angle.
  if (!piece.shape.flat) return facings(p, piece.tris).length > 2
  return facingArea(p, piece.tris, piece.shape.axes[2].axis) >= NEON_HALO.planar * facingArea(p, piece.tris, null) * 4
}

/** A bent piece (a screen round a corner, a curved wrap) as its runs of triangles that face one way. */
function split(p: GlbPrimitive, piece: Piece): Piece[] {
  return facings(p, piece.tris).flatMap(tris => pieces(p, tris))
}

/** Triangles grouped by the way they face, either side alike. */
function facings(p: GlbPrimitive, tris: number[]): number[][] {
  const groups: Array<{ normal: number[]; tris: number[] }> = []
  for (const t of tris) {
    const n = triangleCross(p, t)
    const length = Math.hypot(...n)
    if (length < 1e-9) continue
    const unit = n.map(c => c / length)
    const group = groups.find(g => Math.abs(dot(g.normal, unit)) >= NEON_HALO.parallel)
    if (group) group.tris.push(t)
    else groups.push({ normal: unit, tris: [t] })
  }
  return groups.map(g => g.tris)
}

/** A piece, or null if it is too small to glow. */
function piece(p: GlbPrimitive, tris: number[]): Piece | null {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const i of corners(p, tris)) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p.position[i * 3 + k])
      max[k] = Math.max(max[k], p.position[i * 3 + k])
    }
  }
  if (Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) < NEON_HALO.smallest) return null
  return { tris, min, max, shape: shape(p, tris) }
}

/** The distinct vertices of some triangles. */
function corners(p: GlbPrimitive, tris: number[]): Set<number> {
  const out = new Set<number>()
  for (const t of tris) for (let j = 0; j < 3; j++) out.add(p.index[t + j])
  return out
}

/** Flat pieces facing the same way within `gap` of each other, as one, where together they are still flat. */
function merge(p: GlbPrimitive, list: Piece[]): Piece[] {
  const { gap } = NEON_HALO
  const near = (a: Piece, b: Piece) =>
    a.min[1] - gap <= b.max[1] && b.min[1] - gap <= a.max[1] && a.min[2] - gap <= b.max[2] && b.min[2] - gap <= a.max[2]
  const facing = (a: Piece, b: Piece) => a.shape.flat && b.shape.flat
    && Math.abs(dot(a.shape.axes[2].axis, b.shape.axes[2].axis)) >= NEON_HALO.parallel
  list.sort((a, b) => a.min[0] - b.min[0])
  const parent = list.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]]
    return i
  }
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length && list[j].min[0] - gap <= list[i].max[0]; j++) {
      if (near(list[i], list[j]) && facing(list[i], list[j])) parent[find(j)] = find(i)
    }
  }
  const groups = new Map<number, Piece[]>()
  list.forEach((piece, i) => {
    const root = find(i)
    const group = groups.get(root)
    if (group) group.push(piece)
    else groups.set(root, [piece])
  })
  return [...groups.values()].flatMap(group => {
    if (group.length === 1) return group
    const merged = piece(p, group.flatMap(g => g.tris))!
    // A run of panels round a curve is each flat, but not together.
    const along = (g: Piece) => Math.abs(dot(g.shape.axes[2].axis, merged.shape.axes[2].axis)) >= NEON_HALO.parallel
    return merged.shape.flat && group.every(along) ? [merged] : group
  })
}

const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

function shape(p: GlbPrimitive, tris: number[]): Shape {
  const points = [...corners(p, tris)]
  const at = (i: number, k: number) => p.position[i * 3 + k]
  const mean: Vec3 = [0, 0, 0]
  for (const i of points) for (let k = 0; k < 3; k++) mean[k] += at(i, k) / points.length
  const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  for (const i of points) {
    const d = [0, 1, 2].map(k => at(i, k) - mean[k])
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cov[r][c] += d[r] * d[c]
  }
  const axes = principalAxes(cov).map(axis => {
    let lo = Infinity, hi = -Infinity
    for (const i of points) {
      const t = (at(i, 0) - mean[0]) * axis[0] + (at(i, 1) - mean[1]) * axis[1] + (at(i, 2) - mean[2]) * axis[2]
      lo = Math.min(lo, t)
      hi = Math.max(hi, t)
    }
    return { axis, mid: (lo + hi) / 2, half: (hi - lo) / 2 }
  }).sort((a, b) => b.half - a.half)
  return { mean, axes, flat: axes[2].half <= axes[1].half * NEON_HALO.chunky }
}

/** A card on the piece's two longest principal axes, or a disc if it is about as deep as it is wide. */
function fit(p: GlbPrimitive, piece: Piece, color: Vec3): Halo | null {
  const { mean, axes, flat } = piece.shape
  if (axes[0].half < 0.05) return null
  const centre = [0, 1, 2].map(k => mean[k] + axes.reduce((s, a) => s + a.axis[k] * a.mid, 0)) as Vec3
  const scaled = (a: Axis) => a.axis.map(c => c * a.half) as Vec3
  const margin = Math.min(NEON_HALO.maxReach, Math.max(NEON_HALO.minReach, axes[0].half * NEON_HALO.reach))
  const card = flat ? 4 * axes[0].half * Math.max(axes[1].half, 0.05) : Math.PI * axes[0].half ** 2
  return {
    centre,
    u: scaled(axes[0]),
    v: scaled(axes[1]),
    color,
    margin,
    strength: Math.min(1, facingArea(p, piece.tris, flat ? axes[2].axis : null) / card),
    billboard: !flat,
  }
}

/**
 * The triangles' area seen square on to `normal`, or a quarter of all of it
 * for a disc (a sphere's share seen from any one side). A box's front and back
 * both count, which the cap at 1 absorbs.
 */
function facingArea(p: GlbPrimitive, tris: number[], normal: Vec3 | null): number {
  let area = 0
  for (const t of tris) {
    const cross = triangleCross(p, t)
    area += (normal ? Math.abs(dot(cross, normal)) : Math.hypot(...cross) / 4) / 2
  }
  return area
}

/** Twice a triangle's area, along its normal. */
function triangleCross(p: GlbPrimitive, t: number): number[] {
  const [a, b, c] = [0, 1, 2].map(j => p.index[t + j] * 3)
  const e1 = [0, 1, 2].map(k => p.position[b + k] - p.position[a + k])
  const e2 = [0, 1, 2].map(k => p.position[c + k] - p.position[a + k])
  return [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
}

/** Unit eigenvectors of a symmetric 3×3 matrix, by Jacobi rotations. */
export function principalAxes(matrix: number[][]): Vec3[] {
  const a = matrix.map(row => [...row])
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  for (let sweep = 0; sweep < 24; sweep++) {
    let off = 0
    for (let p = 0; p < 2; p++) for (let q = p + 1; q < 3; q++) off += a[p][q] ** 2
    if (off < 1e-18) break
    for (let p = 0; p < 2; p++) {
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(a[p][q]) < 1e-12) continue
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q])
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1), s = t * c
        for (let k = 0; k < 3; k++) {
          const [akp, akq] = [a[k][p], a[k][q]]
          a[k][p] = c * akp - s * akq
          a[k][q] = s * akp + c * akq
        }
        for (let k = 0; k < 3; k++) {
          const [apk, aqk] = [a[p][k], a[q][k]]
          a[p][k] = c * apk - s * aqk
          a[q][k] = s * apk + c * aqk
        }
        for (let k = 0; k < 3; k++) {
          const [vkp, vkq] = [v[k][p], v[k][q]]
          v[k][p] = c * vkp - s * vkq
          v[k][q] = s * vkp + c * vkq
        }
      }
    }
  }
  return [0, 1, 2].map(j => [v[0][j], v[1][j], v[2][j]] as Vec3)
}
