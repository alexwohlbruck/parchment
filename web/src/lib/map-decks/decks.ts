/**
 * Bridge decks: the geometry behind drawing bridges and elevated roads in 3D.
 *
 * Pure functions, in Web Mercator units (0-1 across the world) for position and
 * metres for height, so the same code can build decks wherever they are drawn.
 *
 *   chains   bridge pieces from many tiles, clipped to their own tiles and
 *            joined end to end into continuous decks
 *   solve    a height for every vertex: an end that meets a road on the ground
 *            sits on the ground, the rest climbs no steeper than a road may to
 *            clear what runs beneath it
 *   mesh     slab, parapets and piers, ready for the GPU
 */

export type Point = [number, number]

export type Piece = {
  points: Point[]
  /** OSM `layer`, at least 1 for a bridge. */
  layer: number
  /** Carriageway width in metres. */
  width: number
  kind: 'road' | 'rail' | 'path'
  /** Zoom and bounds of the tile the piece came from. */
  zoom?: number
  tile?: Bounds
}

/**
 * Pieces with the stretches a closer tile also covers cut away, exactly at
 * that tile's edge so what is left joins the closer tile's pieces end to end.
 * A parent tile stays loaded while its children stream in, so the same bridge
 * can arrive twice and would stand as two overlapping decks.
 */
export function dedupe(pieces: Piece[]): Piece[] {
  const tiles = new Map<string, { zoom: number; bounds: Bounds }>()
  for (const { tile, zoom } of pieces) if (tile && zoom !== undefined) tiles.set(`${zoom}/${tile.minX}/${tile.minY}`, { zoom, bounds: tile })
  const overlap = (a: Bounds, b: Bounds) => a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY
  return pieces.flatMap(piece => {
    if (!piece.tile) return [piece]
    let runs = [piece.points]
    for (const { zoom, bounds } of tiles.values())
      if (zoom > (piece.zoom ?? 0) && overlap(bounds, piece.tile)) runs = runs.flatMap(run => cutOut(run, bounds))
    return runs.map(points => ({ ...piece, points }))
  })
}

export type Chain = Piece & {
  /** Whether each end meets a way on the ground. */
  grounded: [boolean, boolean]
  /** Metres from the centreline to the deck's left and right edges. */
  edges: [number, number]
}

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number }

/** Steepest a deck climbs, as a grade. */
export const MAX_GRADE = 0.06
/** Height per OSM layer that a deck stands clear of the ground beneath it. */
export const LAYER_CLEARANCE = 6
/** Slab depth below the road surface, and parapet height above it, in metres. */
export const SLAB = 1.1
export const PARAPET = 0.9
/** Distance between piers, in metres, and the least height worth a pier. */
export const PIER_SPACING = 28
export const PIER_MIN = 2.5

const WORLD = 40075016.686

/** Metres per mercator unit at a mercator y. */
export function metresPerUnit(y: number): number {
  const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * y)))
  return WORLD * Math.cos(lat)
}

/** The stretch of a segment inside a box, as parameters from 0 to 1 along it (Liang-Barsky); null if none. */
function span([x0, y0]: Point, [x1, y1]: Point, b: Bounds): [number, number] | null {
  const dx = x1 - x0
  const dy = y1 - y0
  let t0 = 0
  let t1 = 1
  for (const [p, q] of [[-dx, x0 - b.minX], [dx, b.maxX - x0], [-dy, y0 - b.minY], [dy, b.maxY - y0]]) {
    if (p === 0) {
      if (q < 0) return null
    } else {
      const r = q / p
      if (p < 0) t0 = Math.max(t0, r)
      else t1 = Math.min(t1, r)
    }
  }
  return t0 > t1 ? null : [t0, t1]
}

const lerp = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]

/** A line cut to a box, as the runs of it that lie inside. */
export function clip(points: Point[], b: Bounds): Point[][] {
  const runs: Point[][] = []
  let run: Point[] = []
  const flush = () => {
    if (run.length >= 2) runs.push(run)
    run = []
  }
  for (let i = 1; i < points.length; i++) {
    const inside = span(points[i - 1], points[i], b)
    if (!inside) {
      flush()
      continue
    }
    if (!run.length) run.push(lerp(points[i - 1], points[i], inside[0]))
    run.push(lerp(points[i - 1], points[i], inside[1]))
    if (inside[1] < 1) flush()
  }
  flush()
  return runs
}

/** A line with a box cut out of it, as the runs of it that lie outside. */
export function cutOut(points: Point[], b: Bounds): Point[][] {
  const runs: Point[][] = []
  let run: Point[] = []
  const flush = () => {
    if (run.length >= 2) runs.push(run)
    run = []
  }
  for (let i = 1; i < points.length; i++) {
    const [a, c] = [points[i - 1], points[i]]
    const inside = span(a, c, b)
    if (!run.length) run.push(a)
    if (!inside) {
      run.push(c)
      continue
    }
    if (inside[0] > 0) run.push(lerp(a, c, inside[0]))
    flush()
    if (inside[1] < 1) run.push(lerp(a, c, inside[1]), c)
    else run = []
  }
  flush()
  return runs
}

const near = (a: Point, b: Point, tolerance: number) =>
  Math.abs(a[0] - b[0]) < tolerance && Math.abs(a[1] - b[1]) < tolerance

/**
 * Join pieces that meet end to end into chains, and mark which ends land on
 * the ground. An end is in the air if it touches another deck (a ramp joining
 * an overpass, whatever its layer) or was cut at the edge of a tile that is not
 * loaded; otherwise the bridge ends there and the road carries on at grade.
 * `tolerance` is in mercator units.
 */
export function chains(pieces: Piece[], cut: (p: Point) => boolean, tolerance: number): Chain[] {
  const open = pieces.map(p => ({ ...p, points: [...p.points] }))
  const joined: Piece[] = []
  while (open.length) {
    const chain = open.pop()!
    let grew = true
    while (grew) {
      grew = false
      for (let i = 0; i < open.length; i++) {
        const other = open[i]
        if (other.layer !== chain.layer || other.kind !== chain.kind) continue
        const [head, tail] = [chain.points[0], chain.points[chain.points.length - 1]]
        const [first, last] = [other.points[0], other.points[other.points.length - 1]]
        let points: Point[] | null = null
        if (near(tail, first, tolerance)) points = [...chain.points, ...other.points.slice(1)]
        else if (near(tail, last, tolerance)) points = [...chain.points, ...[...other.points].reverse().slice(1)]
        else if (near(head, last, tolerance)) points = [...other.points, ...chain.points.slice(1)]
        else if (near(head, first, tolerance)) points = [...[...other.points].reverse(), ...chain.points.slice(1)]
        if (points) {
          chain.points = points
          chain.width = Math.max(chain.width, other.width)
          open.splice(i, 1)
          grew = true
          break
        }
      }
    }
    joined.push(chain)
  }
  const cell = tolerance * 4
  const key = (x: number, y: number) => `${x},${y}`
  const index = new Map<string, Array<[Point, number]>>()
  joined.forEach((c, id) => {
    for (const p of c.points) {
      const k = key(Math.floor(p[0] / cell), Math.floor(p[1] / cell))
      const list = index.get(k)
      if (list) list.push([p, id])
      else index.set(k, [[p, id]])
    }
  })
  const elsewhere = (p: Point, self: number) => {
    const [cx, cy] = [Math.floor(p[0] / cell), Math.floor(p[1] / cell)]
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const [q, id] of index.get(key(cx + dx, cy + dy)) ?? []) if (id !== self && near(p, q, tolerance)) return true
    return false
  }
  return joined.map((c, id) => {
    const ends = [c.points[0], c.points[c.points.length - 1]]
    const [a, b] = ends.map(p => !cut(p) && !elsewhere(p, id))
    return { ...c, grounded: [a, b] as [boolean, boolean], edges: [c.width / 2, c.width / 2] as [number, number] }
  })
}

/** Farthest a kerb or sidewalk may lie from a deck's centreline and still be part of it, in metres. */
export const MAX_REACH = 16

/**
 * Where a point lies beside a line: metres from it, which side (left in the
 * sense of `deckMesh`), and whether it falls alongside a segment rather than
 * off either end of the line.
 */
export function beside(points: Point[], q: Point): { distance: number; left: boolean; alongside: boolean; segment: number; t: number } {
  let best = { distance: Infinity, left: true, alongside: false, segment: 1, t: 0 }
  const scale = metresPerUnit(q[1])
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const raw = ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)
    const t = Math.max(0, Math.min(1, raw))
    const distance = Math.hypot(a[0] + dx * t - q[0], a[1] + dy * t - q[1]) * scale
    if (distance < best.distance) {
      const alongside = (raw >= 0 || i > 1) && (raw <= 1 || i < points.length - 1)
      best = { distance, left: (q[0] - a[0]) * -dy + (q[1] - a[1]) * dx > 0, alongside, segment: i, t }
    }
  }
  return best
}

/**
 * A road deck's edges fitted to its kerbs: the farthest outline point on each
 * side. A side with none mirrors the other; with none at all the deck keeps
 * its width.
 */
export function fitEdges(chain: Chain, kerbs: Point[]): [number, number] {
  const reach: [number, number] = [0, 0]
  for (const q of kerbs) {
    const { distance, left, alongside } = beside(chain.points, q)
    if (alongside && distance < MAX_REACH) reach[left ? 0 : 1] = Math.max(reach[left ? 0 : 1], distance)
  }
  if (!reach[0] && !reach[1]) return chain.edges
  return [reach[0] || reach[1], reach[1] || reach[0]]
}

/**
 * Sidewalks and cycle tracks mapped as bridges of their own beside a road
 * bridge, folded into its deck: the deck widens to take them in, and they are
 * no longer decks themselves.
 */
export function absorbPaths(decks: Chain[]): Chain[] {
  const roads = decks.filter(d => d.kind === 'road').map(d => ({ ...d, edges: [...d.edges] as [number, number] }))
  const kept: Chain[] = []
  for (const path of decks) {
    if (path.kind !== 'path') {
      if (path.kind !== 'road') kept.push(path)
      continue
    }
    const samples = path.points.flatMap((p, i) => (i ? [[(p[0] + path.points[i - 1][0]) / 2, (p[1] + path.points[i - 1][1]) / 2] as Point, p] : [p]))
    const host = roads.find(road => {
      if (road.layer !== path.layer) return false
      const near = samples.map(q => beside(road.points, q))
      const side = near[0].left
      const inside = near.filter(n => n.alongside).map(n => n.distance)
      return inside.length >= near.length / 2 && Math.max(...inside) - Math.min(...inside) < 4 &&
        near.every(n => n.left === side && n.distance < Math.max(road.edges[side ? 0 : 1], 1) + MAX_REACH / 2)
    })
    if (!host) {
      kept.push(path)
      continue
    }
    const near = samples.map(q => beside(host.points, q)).filter(n => n.alongside)
    const side = near[0].left ? 0 : 1
    host.edges[side] = Math.max(host.edges[side], ...near.map(n => n.distance + path.width / 2))
  }
  return [...roads, ...kept]
}

/** Whether a point lies on the edge of a box, within `tolerance`. */
export function onEdge(p: Point, b: Bounds, tolerance: number): boolean {
  return Math.abs(p[0] - b.minX) < tolerance || Math.abs(p[0] - b.maxX) < tolerance ||
    Math.abs(p[1] - b.minY) < tolerance || Math.abs(p[1] - b.maxY) < tolerance
}

/** Distances along a chain in metres, from its first point. */
export function along(points: Point[]): number[] {
  const out = [0]
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1]
    const [x1, y1] = points[i]
    out.push(out[i - 1] + Math.hypot(x1 - x0, y1 - y0) * metresPerUnit((y0 + y1) / 2))
  }
  return out
}

/**
 * Deck height, in metres above the datum the ground is measured in, at every
 * vertex of a chain.
 *
 * Each end on the ground sits on it, and an end that is not stays a layer's
 * clearance up. Between, the deck runs straight from end to end, lifted to its
 * clearance over the ground below, and held to `MAX_GRADE` from each grounded
 * end so a short bridge over a creek is a gentle hump, not a ramp.
 */
export function solve(chain: Chain, groundAt: number[], resting: [number | null, number | null] = [null, null]): number[] {
  const d = along(chain.points)
  const total = d[d.length - 1] || 1
  const clearance = LAYER_CLEARANCE * Math.max(1, chain.layer)
  const n = groundAt.length
  // An end rests on the ground, on another deck at the height given, or is
  // left a layer up.
  const end = (i: 0 | 1, g: number) => resting[i] ?? (chain.grounded[i] ? g : g + clearance)
  const anchored = [chain.grounded[0] || resting[0] !== null, chain.grounded[1] || resting[1] !== null]
  const za = end(0, groundAt[0])
  const zb = end(1, groundAt[n - 1])
  return groundAt.map((g, i) => {
    const straight = za + ((zb - za) * d[i]) / total
    let z = Math.max(straight, g + clearance)
    if (anchored[0]) z = Math.min(z, za + MAX_GRADE * d[i])
    if (anchored[1]) z = Math.min(z, zb + MAX_GRADE * (total - d[i]))
    return Math.max(z, Math.max(straight, g))
  })
}

/** Height at a point along a solved chain, by distance. */
export function heightAt(d: number[], z: number[], at: number): number {
  if (at <= 0) return z[0]
  for (let i = 1; i < d.length; i++)
    if (at <= d[i]) return z[i - 1] + ((z[i] - z[i - 1]) * (at - d[i - 1])) / (d[i] - d[i - 1] || 1)
  return z[z.length - 1]
}

/** Per vertex, whether each side of a deck (left, right) runs against another deck. */
export type Sides = [boolean[], boolean[]]

/** A line with points added so no segment is longer than `step` metres. */
export function densify(points: Point[], step: number): Point[] {
  const out: Point[] = points.length ? [points[0]] : []
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]]
    const metres = Math.hypot(b[0] - a[0], b[1] - a[1]) * metresPerUnit((a[1] + b[1]) / 2)
    const n = Math.max(1, Math.ceil(metres / step))
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n])
  }
  return out
}

/** Each vertex's points on a deck's left and right edges, for sampling the ground beneath them. */
export function edgePoints(chain: Chain): [Point[], Point[]] {
  const pts = chain.points
  const n = pts.length
  const scale = 1 / metresPerUnit(pts[Math.floor(n / 2)][1])
  const left: Point[] = []
  const right: Point[] = []
  pts.forEach((p, i) => {
    const [a, b] = [pts[Math.max(0, i - 1)], pts[Math.min(n - 1, i + 1)]]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    const [nx, ny] = [-(b[1] - a[1]) / len * scale, (b[0] - a[0]) / len * scale]
    left.push([p[0] + nx * chain.edges[0], p[1] + ny * chain.edges[0]])
    right.push([p[0] - nx * chain.edges[1], p[1] - ny * chain.edges[1]])
  })
  return [left, right]
}

/**
 * The ground a deck must clear: under its centreline, or higher under either
 * edge, but rising toward an edge no faster than the deck may climb from its
 * nearer end. A road enters a bridge in a cut as often as on a bank, and the
 * slopes beside it at the abutment are not something to climb over.
 */
export function besideGround(centre: number[], left: number[], right: number[], d: number[]): number[] {
  const total = d[d.length - 1] ?? 0
  return centre.map((g, i) => {
    const edges = [left[i], right[i]].filter(h => !Number.isNaN(h))
    const base = Number.isNaN(g) ? (edges.length ? Math.min(...edges) : NaN) : g
    if (Number.isNaN(base) || !edges.length) return base
    return Math.max(base, Math.min(Math.max(...edges), base + MAX_GRADE * Math.min(d[i], total - d[i])))
  })
}

/**
 * A deck's profile eased into a vertical curve: each interior height averaged
 * over `span` metres around it, the ends kept, and never below the ground.
 */
export function smooth(z: number[], d: number[], ground: number[], span = 24): number[] {
  const n = z.length
  return z.map((_, i) => {
    if (i === 0 || i === n - 1) return z[i]
    let sum = 0
    let weight = 0
    for (let k = 0; k < n; k++) {
      const w = span / 2 - Math.abs(d[k] - d[i])
      if (w > 0) {
        sum += z[k] * w
        weight += w
      }
    }
    return Math.max(sum / weight, ground[i])
  })
}

/**
 * Decks that run side by side as one: where a deck's edge meets another's
 * within `gap` metres and at about its height, both take the higher height
 * there and lose the parapet between them. Heights are updated in place.
 */
export function joinNeighbours(decks: Array<{ chain: Chain; z: number[] }>, gap = 1.5, step = 1.5): Sides[] {
  const open: Sides[] = decks.map(({ chain }) => [chain.points.map(() => false), chain.points.map(() => false)])
  for (const [a, A] of decks.entries())
    for (const [b, B] of decks.entries()) {
      if (a === b || A.chain.kind === 'rail' || B.chain.kind === 'rail') continue
      A.chain.points.forEach((p, i) => {
        const near = beside(B.chain.points, p)
        if (!near.alongside) return
        const [j, t] = [near.segment, near.t]
        const zb = B.z[j - 1] + (B.z[j] - B.z[j - 1]) * t
        if (Math.abs(zb - A.z[i]) > step) return
        const q: Point = [
          B.chain.points[j - 1][0] + (B.chain.points[j][0] - B.chain.points[j - 1][0]) * t,
          B.chain.points[j - 1][1] + (B.chain.points[j][1] - B.chain.points[j - 1][1]) * t,
        ]
        const facing = beside(A.chain.points, q).left ? 0 : 1
        if (near.distance > A.chain.edges[facing] + B.chain.edges[near.left ? 0 : 1] + gap) return
        open[a][facing][i] = true
        A.z[i] = Math.max(A.z[i], zb)
      })
    }
  return open
}

export type Mesh = { position: number[]; normal: number[]; color: number[] }

export type DeckColors = { surface: number[]; concrete: number[]; parapet: number[] }

/**
 * The triangles of one solved chain, in mercator units relative to `origin`,
 * with heights already multiplied by `perMetre` (mercator units per metre).
 */
export function deckMesh(
  chain: Chain,
  z: number[],
  groundAt: number[],
  origin: Point,
  colors: DeckColors,
  out: Mesh,
  open: Sides = [[], []],
): Mesh {
  const pts = chain.points
  const n = pts.length
  const scale = 1 / metresPerUnit(pts[Math.floor(n / 2)][1])
  const [toLeft, toRight] = chain.edges.map(e => e * scale)
  const span = chain.edges[0] + chain.edges[1]
  // Mitred sides, the mitre capped so a hairpin does not spike.
  const sides = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(n - 1, i + 1)]
    let tx = b[0] - a[0]
    let ty = b[1] - a[1]
    const len = Math.hypot(tx, ty) || 1
    tx /= len
    ty /= len
    let nx = -ty
    let ny = tx
    let m = 1
    if (i > 0 && i < n - 1) {
      const ux = (p[0] - a[0]) / (Math.hypot(p[0] - a[0], p[1] - a[1]) || 1)
      const uy = (p[1] - a[1]) / (Math.hypot(p[0] - a[0], p[1] - a[1]) || 1)
      const dot = nx * -uy + ny * ux
      m = 1 / Math.max(0.5, Math.abs(dot))
    }
    nx *= m
    ny *= m
    return {
      left: [p[0] + nx * toLeft - origin[0], p[1] + ny * toLeft - origin[1]] as Point,
      right: [p[0] - nx * toRight - origin[0], p[1] - ny * toRight - origin[1]] as Point,
    }
  })
  const h = (m: number) => m * scale
  const push = (a: number[], b: number[], c: number[], color: number[]) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    const nn = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const l = Math.hypot(nn[0], nn[1], nn[2]) || 1
    for (const p of [a, b, c]) {
      out.position.push(p[0], p[1], p[2])
      out.normal.push(nn[0] / l, nn[1] / l, nn[2] / l)
      out.color.push(color[0], color[1], color[2])
    }
  }
  const quad = (a: number[], b: number[], c: number[], d: number[], color: number[]) => {
    push(a, b, c, color)
    push(a, c, d, color)
  }
  const at = (p: Point, metres: number) => [p[0], p[1], h(metres)]
  const inset = (s: { left: Point; right: Point }, side: 'left' | 'right', by: number): Point => {
    const other = side === 'left' ? s.right : s.left
    const p = s[side]
    const k = by / (span || 1)
    return [p[0] + (other[0] - p[0]) * k, p[1] + (other[1] - p[1]) * k]
  }
  for (let i = 1; i < n; i++) {
    const [s0, s1] = [sides[i - 1], sides[i]]
    const [z0, z1] = [z[i - 1], z[i]]
    // Road surface, both sides of the slab, and its underside.
    quad(at(s0.left, z0), at(s0.right, z0), at(s1.right, z1), at(s1.left, z1), colors.surface)
    quad(at(s0.right, z0), at(s0.right, z0 - SLAB), at(s1.right, z1 - SLAB), at(s1.right, z1), colors.concrete)
    quad(at(s1.left, z1), at(s1.left, z1 - SLAB), at(s0.left, z0 - SLAB), at(s0.left, z0), colors.concrete)
    quad(at(s0.left, z0 - SLAB), at(s1.left, z1 - SLAB), at(s1.right, z1 - SLAB), at(s0.right, z0 - SLAB), colors.concrete)
    // Parapets along both edges.
    for (const side of ['left', 'right'] as const) {
      const shared = open[side === 'left' ? 0 : 1]
      if (shared[i - 1] && shared[i]) continue
      const [o0, o1] = [s0[side], s1[side]]
      const [i0, i1] = [inset(s0, side, 0.3), inset(s1, side, 0.3)]
      const flip = side === 'left'
      const face = (a: number[], b: number[], c: number[], d: number[]) =>
        flip ? quad(a, b, c, d, colors.parapet) : quad(d, c, b, a, colors.parapet)
      face(at(o0, z0), at(o0, z0 + PARAPET), at(o1, z1 + PARAPET), at(o1, z1))
      face(at(i1, z1), at(i1, z1 + PARAPET), at(i0, z0 + PARAPET), at(i0, z0))
      face(at(o0, z0 + PARAPET), at(i0, z0 + PARAPET), at(i1, z1 + PARAPET), at(o1, z1 + PARAPET))
    }
  }
  // Piers, where the deck stands high enough to need them.
  const d = along(pts)
  const total = d[n - 1]
  for (let at_ = PIER_SPACING / 2; at_ < total; at_ += PIER_SPACING) {
    const top = heightAt(d, z, at_) - SLAB
    const bottom = heightAt(d, groundAt, at_)
    if (top - bottom < PIER_MIN) continue
    let k = 1
    while (k < n - 1 && d[k] < at_) k++
    const t = (at_ - d[k - 1]) / (d[k] - d[k - 1] || 1)
    const cx = pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * t - origin[0]
    const cy = pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * t - origin[1]
    const r = Math.min(0.9, span / 6) * scale
    const corners: Point[] = [[cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r]]
    for (let c = 0; c < 4; c++) {
      const [a, b] = [corners[c], corners[(c + 1) % 4]]
      quad([a[0], a[1], h(bottom)], [b[0], b[1], h(bottom)], [b[0], b[1], h(top)], [a[0], a[1], h(top)], colors.concrete)
    }
  }
  return out
}

/**
 * A line laid on solved decks: each vertex lifted to the deck beneath it, or
 * null where the line leaves every deck. `lift` is the height above the deck
 * surface, so paint does not fight the asphalt for the same depth.
 */
export function onDeck(
  points: Point[],
  decks: Array<{ points: Point[]; z: number[]; d: number[]; width: number }>,
  lift: number,
): Array<number | null> {
  return points.map(p => {
    let best: number | null = null
    let bestDistance = Infinity
    for (const deck of decks) {
      const scale = metresPerUnit(p[1])
      for (let i = 1; i < deck.points.length; i++) {
        const [a, b] = [deck.points[i - 1], deck.points[i]]
        const dx = b[0] - a[0]
        const dy = b[1] - a[1]
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)))
        const distance = Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]) * scale
        if (distance < deck.width / 2 + 0.5 && distance < bestDistance) {
          bestDistance = distance
          best = deck.z[i - 1] + (deck.z[i] - deck.z[i - 1]) * t + lift
        }
      }
    }
    return best
  })
}
