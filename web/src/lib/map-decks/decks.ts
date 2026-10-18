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
  /** A road's class, `_link` for a slip road. */
  road?: string
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
  /** Metres from the centreline to the deck's left and right edges: the widest, where they vary. */
  edges: [number, number]
  /** Metres from the centreline to the left and right edges at each vertex, for a deck following its outline. */
  sides?: [number[], number[]]
  /** Metres each side stops short of the start and end: [start left, start right, end left, end right], negative running on past. */
  caps?: [number, number, number, number]
}

/** Metres from a deck's centreline to one side (0 left, 1 right) at a vertex, or `t` of the way to the next. */
export function sideAt(chain: Pick<Chain, 'edges' | 'sides'>, side: 0 | 1, i: number, t = 0): number {
  const s = chain.sides?.[side]
  if (!s) return chain.edges[side]
  return t ? s[i] + (s[Math.min(i + 1, s.length - 1)] - s[i]) * t : s[i]
}

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number }

/** Steepest a deck climbs, as a grade. */
export const MAX_GRADE = 0.06
/** Height per OSM layer that a deck stands clear of the ground beneath it. */
export const LAYER_CLEARANCE = 6
/** Length of the vertical curve a deck's grades are eased into, in metres. */
export const VERTICAL_CURVE = 90
/** Metres each side of a vertex whose ground is read together, so a lone tree or stray pixel does not lift a deck. */
export const GROUND_SPAN = 12
/** Slab depth below the road surface, and parapet height above it, in metres. */
export const SLAB = 0.8
export const PARAPET = 0.9
/** A pier's columns: radius and sides, a column to every BENT metres of deck width, under a cap beam CAP deep, in metres. */
export const COLUMN = 0.55
export const COLUMN_SIDES = 8
export const BENT = 11
export const CAP = 0.7
/** Distance between piers, in metres, and the least height worth a pier. */
export const PIER_SPACING = 28
export const PIER_MIN = 2.5
/** How far a pier runs on below the ground, and the least height a deck needs over it to be more than road, in metres. */
export const FOOTING = 0.5
export const BOX_MIN = 1

const WORLD = 40075016.686

/**
 * Where a deck built here stands its piers: every PIER_SPACING metres where it
 * stands high enough, each moved to the nearest place within a quarter span
 * where `clear` allows its bent, or left out.
 */
export function placedPiers(chain: Chain, z: number[], groundAt: number[], clear: (at: number) => boolean): number[] {
  const d = along(chain.points)
  const total = d[d.length - 1]
  const out: number[] = []
  for (let s = PIER_SPACING / 2; s < total; s += PIER_SPACING) {
    for (let shift = 0; shift <= PIER_SPACING / 4; shift++) {
      const at = [s - shift, s + shift].find(a => a > 0 && a < total && heightAt(d, z, a) - heightAt(d, groundAt, a) >= PIER_MIN && clear(a))
      if (at !== undefined) {
        out.push(at)
        break
      }
    }
  }
  return out
}

/** 0 at 0, 1 at 1, level at both. */
export const smoothstep = (u: number) => u * u * (3 - 2 * u)

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

/** A line's bounds, grown by `metres` all round. */
export function boundsOf(points: Point[], metres = 0): Bounds {
  const pad = metres ? metres / metresPerUnit(points[0][1]) : 0
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const [x, y] of points) [minX, minY, maxX, maxY] = [Math.min(minX, x), Math.min(minY, y), Math.max(maxX, x), Math.max(maxY, y)]
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad }
}

export const meets = (a: Bounds, b: Bounds) => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY

export const holds = (b: Bounds, [x, y]: Point) => x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY

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
        const at = points && (points[chain.points.length - 1] === chain.points[chain.points.length - 1] ? chain.points.length - 1 : other.points.length - 1)
        if (points && !(chain.kind !== 'path' && folds(points, at!))) {
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

/** Whether two lines joined at `points[at]` turn back on each other there, as roads part at a gore or tracks at a turnout. */
function folds(points: Point[], at: number): boolean {
  const [a, b, c] = [points[at - 1], points[at], points[at + 1]]
  if (!a || !c) return false
  return (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]) < 0
}

/** Farthest a kerb or sidewalk may lie from a deck's centreline and still be part of it, in metres. */
export const MAX_REACH = 16

/**
 * Where a point lies beside a line: metres from it, which side (left in the
 * sense of `deckMesh`), and whether it falls alongside a segment rather than
 * off either end of the line. `segments`, by the index of their second
 * point, limits the search to those.
 */
export function beside(points: Point[], q: Point, segments?: number[]): { distance: number; left: boolean; alongside: boolean; segment: number; t: number } {
  let best = { distance: Infinity, left: true, alongside: false, segment: 1, t: 0 }
  const scale = metresPerUnit(q[1])
  const count = segments ? segments.length : points.length - 1
  for (let k = 0; k < count; k++) {
    const i = segments ? segments[k] : k + 1
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

/** Tracks in a road bridge's carriageway (a street-running tram), dropped as decks of their own, by barrelman's rule. */
export function absorbTracks(decks: Chain[]): Chain[] {
  const roads = decks.filter(d => d.kind === 'road')
  return decks.filter(track => {
    if (track.kind !== 'rail') return true
    const samples = densify(track.points, 3)
    return !roads.some(road => {
      if (road.layer !== track.layer) return false
      let within = 0
      for (const q of samples) {
        const near = beside(road.points, q)
        if (near.alongside && near.distance <= road.edges[near.left ? 0 : 1]) within++
        else if (near.alongside || near.distance > RUN_PAST) return false
      }
      return within >= samples.length * 0.8
    })
  })
}

/** Farthest a track folded into a road may run on past the road's end, in metres. */
export const RUN_PAST = 15

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
 * Ground with lone spikes taken out: at each vertex, the median of those
 * within GROUND_SPAN of it, the span shrinking toward the ends so a slope
 * reads true and each end keeps its own.
 */
export function steady(ground: number[], d: number[]): number[] {
  const total = d[d.length - 1] ?? 0
  return ground.map((_, i) => {
    const half = Math.min(GROUND_SPAN, d[i], total - d[i])
    const near: number[] = []
    for (let k = i; k >= 0 && d[i] - d[k] <= half; k--) near.push(ground[k])
    for (let k = i + 1; k < ground.length && d[k] - d[i] <= half; k++) near.push(ground[k])
    near.sort((a, b) => a - b)
    return near[near.length >> 1]
  })
}

/**
 * The lowest concave profile on or over `lower`, through its first and last
 * values: a line drawn taut across the tops of what a deck must clear. It
 * has crests and no sags, as a bridge's grade line does.
 */
export function arch(d: number[], lower: number[]): number[] {
  const hull: number[] = []
  for (let i = 0; i < lower.length; i++) {
    while (hull.length >= 2) {
      const [a, b] = [hull[hull.length - 2], hull[hull.length - 1]]
      if ((d[b] - d[a]) * (lower[i] - lower[a]) - (lower[b] - lower[a]) * (d[i] - d[a]) < 0) break
      hull.pop()
    }
    hull.push(i)
  }
  let k = 0
  return d.map(s => {
    while (k < hull.length - 2 && d[hull[k + 1]] < s) k++
    const [a, b] = [hull[k], hull[Math.min(k + 1, hull.length - 1)]]
    return a === b ? lower[a] : lower[a] + ((lower[b] - lower[a]) * (s - d[a])) / (d[b] - d[a] || 1)
  })
}

/**
 * Deck height, in metres above the datum the ground is measured in, at every
 * vertex of a chain.
 *
 * Each end on the ground sits on it, and an end that is not stays a layer's
 * clearance up. Between, the deck arches a layer's clearance over the ground
 * below, held to `MAX_GRADE` from each grounded end so a short bridge over a
 * creek is a gentle hump, not a ramp, and never sags between what it clears.
 */
export function solve(chain: Chain, groundAt: number[], resting: [number | null, number | null] = [null, null]): number[] {
  const d = along(chain.points)
  const total = d[d.length - 1] || 1
  const clearance = LAYER_CLEARANCE * Math.max(1, chain.layer)
  const n = groundAt.length
  // An end rests on the ground, on another deck at the height given, or is
  // left a layer up.
  const end = (i: 0 | 1, g: number) => {
    const rest = resting[i]
    return rest !== null ? Math.max(rest, g) : chain.grounded[i] ? g : g + clearance
  }
  const anchored = [chain.grounded[0] || resting[0] !== null, chain.grounded[1] || resting[1] !== null]
  const [za, zb] = [end(0, groundAt[0]), end(1, groundAt[n - 1])]
  const floor = steady(groundAt, d)
  const lower = floor.map(g => g + clearance)
  lower[0] = za
  lower[n - 1] = zb
  return arch(d, lower).map((z, i) => {
    if (anchored[0]) z = Math.min(z, za + MAX_GRADE * d[i])
    if (anchored[1]) z = Math.min(z, zb + MAX_GRADE * (total - d[i]))
    return Math.max(z, za + ((zb - za) * d[i]) / total, floor[i])
  })
}

/** Height at a point along a solved chain, by distance. */
export function heightAt(d: number[], z: number[], at: number): number {
  if (at <= 0) return z[0]
  for (let i = 1; i < d.length; i++)
    if (at <= d[i]) return z[i - 1] + ((z[i] - z[i - 1]) * (at - d[i - 1])) / (d[i] - d[i - 1] || 1)
  return z[z.length - 1]
}

/** A line's segments by grid cell, each by the index of its second point. */
type SegmentIndex = { cell: number; cells: Map<number, number[]> }

/** Metres across a cell of a segment index. */
const INDEX_CELL = 24

const cellKey = (x: number, y: number) => x * 4194304 + y

function segmentIndex(points: Point[]): SegmentIndex {
  const cell = INDEX_CELL / metresPerUnit(points[0][1])
  const cells = new Map<number, number[]>()
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]]
    for (let x = Math.floor(Math.min(a[0], b[0]) / cell); x <= Math.floor(Math.max(a[0], b[0]) / cell); x++)
      for (let y = Math.floor(Math.min(a[1], b[1]) / cell); y <= Math.floor(Math.max(a[1], b[1]) / cell); y++) {
        const list = cells.get(cellKey(x, y))
        if (list) list.push(i)
        else cells.set(cellKey(x, y), [i])
      }
  }
  return { cell, cells }
}

/** The segments of an indexed line that may lie within `metres` of a point; a segment can appear more than once. */
function nearSegments({ cell, cells }: SegmentIndex, p: Point, metres: number): number[] {
  const r = metres / metresPerUnit(p[1])
  const out: number[] = []
  for (let x = Math.floor((p[0] - r) / cell); x <= Math.floor((p[0] + r) / cell); x++)
    for (let y = Math.floor((p[1] - r) / cell); y <= Math.floor((p[1] + r) / cell); y++) {
      const list = cells.get(cellKey(x, y))
      if (list) for (const i of list) out.push(i)
    }
  return out
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
    const [l, r] = [sideAt(chain, 0, i), sideAt(chain, 1, i)]
    left.push([p[0] + nx * l, p[1] + ny * l])
    right.push([p[0] - nx * r, p[1] - ny * r])
  })
  return [left, right]
}

/** A grounded deck's ends: where its way meets the road on the ground, and the way's direction out of it. */
export function wayEnds(chain: Chain): Array<{ p: Point; out: Point; half: number }> {
  const pts = chain.points
  const n = pts.length
  if (n < 2) return []
  const unit = (a: Point, b: Point): Point => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l] }
  return [
    ...(chain.grounded[0] ? [{ p: pts[0], out: unit(pts[1], pts[0]), half: Math.max(...chain.edges) }] : []),
    ...(chain.grounded[1] ? [{ p: pts[n - 1], out: unit(pts[n - 2], pts[n - 1]), half: Math.max(...chain.edges) }] : []),
  ]
}

/** Metres along a way from its end within which carriageway corners make up the joint there. */
const JOINT_ALONG = 1.2

/**
 * The joint at each way end: the convex hull of the carriageway corners lying
 * at it within the deck's width, from both the road on the ground and the bridge's own, so the wedge
 * between their square ends is paved. None where fewer than three corners lie there.
 */
export function jointAreas(ends: Array<{ p: Point; out: Point; half: number }>, rings: Point[][], cluster = Infinity): Point[][] {
  return ends.flatMap(({ p, out, half }) => {
    const scale = metresPerUnit(p[1])
    const near: Point[] = []
    for (const ring of rings)
      for (const q of ring) {
        const [dx, dy] = [(q[0] - p[0]) * scale, (q[1] - p[1]) * scale]
        if (Math.abs(dx * out[0] + dy * out[1]) <= JOINT_ALONG && Math.abs(-dx * out[1] + dy * out[0]) <= half + 0.5) near.push(q)
      }
    return (cluster === Infinity ? [near] : clusters(near, cluster / scale)).map(convexHull).filter(hull => hull.length >= 3)
  })
}

/** Points grouped so each lies within `reach` of another in its group. */
function clusters(points: Point[], reach: number): Point[][] {
  const groups: Point[][] = []
  for (const q of points) {
    const joined = groups.filter(g => g.some(r => Math.hypot(r[0] - q[0], r[1] - q[1]) <= reach))
    const merged = [q, ...joined.flat()]
    for (const g of joined) groups.splice(groups.indexOf(g), 1)
    groups.push(merged)
  }
  return groups
}

/** The convex hull of some points (monotone chain). */
export function convexHull(points: Point[]): Point[] {
  const ps = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (ps.length < 3) return ps
  const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const half = (list: Point[]) => {
    const h: Point[] = []
    for (const q of list) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop()
      h.push(q)
    }
    return h.slice(0, -1)
  }
  return [...half(ps), ...half([...ps].reverse())]
}

/** A ring grown outward by `metres`, each corner moved along its mitre. */
export function grownRing(ring: Point[], metres: number): Point[] {
  const n = ring.length
  if (n < 3) return ring
  const scale = metres / metresPerUnit(ring[0][1])
  let area = 0
  for (let i = 0; i < n; i++) area += ring[i][0] * ring[(i + 1) % n][1] - ring[(i + 1) % n][0] * ring[i][1]
  const out = area > 0 ? 1 : -1
  return ring.map((p, i) => {
    const [a, b] = [ring[(i - 1 + n) % n], ring[(i + 1) % n]]
    const n1 = norm([p[1] - a[1], a[0] - p[0]])
    const n2 = norm([b[1] - p[1], p[0] - b[0]])
    const m = norm([n1[0] + n2[0], n1[1] + n2[1]])
    const k = 1 / Math.max(0.5, m[0] * n1[0] + m[1] * n1[1])
    return [p[0] + m[0] * scale * k * out, p[1] + m[1] * scale * k * out] as Point
  })
}

const norm = ([x, y]: number[]): Point => {
  const l = Math.hypot(x, y) || 1
  return [x / l, y / l]
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
 * A deck's profile eased into vertical curves `span` metres long, never below
 * the ground. Each height is averaged over a window that shrinks toward the
 * ends, so the ends stay put and a straight grade stays straight.
 */
export function smooth(z: number[], d: number[], ground: number[], span = VERTICAL_CURVE): number[] {
  const n = z.length
  const total = d[n - 1] ?? 0
  let lo = 0
  return z.map((_, i) => {
    const half = Math.min(span / 2, d[i], total - d[i])
    if (half <= 0) return z[i]
    while (d[i] - d[lo] >= half) lo++
    let sum = 0
    let weight = 0
    for (let k = lo; k < n && d[k] - d[i] < half; k++) {
      const w = half - Math.abs(d[k] - d[i])
      sum += z[k] * w
      weight += w
    }
    return Math.max(sum / weight, ground[i])
  })
}

/**
 * Decks that run side by side as one: where a deck's edge meets another's
 * within `gap` metres and at about its height, both take the higher height
 * there and lose the parapet between them. Tracks join only tracks. Heights are updated in place,
 * except a `fixed` deck's, whose were joined where they were solved.
 */
export function joinNeighbours(decks: Array<{ chain: Chain; z: number[]; fixed?: boolean }>, gap = 1.5, step = 1.5): Sides[] {
  const open: Sides[] = decks.map(({ chain }) => [chain.points.map(() => false), chain.points.map(() => false)])
  const bounds = decks.map(({ chain }) => boundsOf(chain.points, Math.max(...chain.edges) + gap))
  const indexes = decks.map(({ chain }) => segmentIndex(chain.points))
  for (const [a, A] of decks.entries())
    for (const [b, B] of decks.entries()) {
      if (a === b || (A.chain.kind === 'rail') !== (B.chain.kind === 'rail') || !meets(bounds[a], bounds[b])) continue
      // Farthest a point of one may lie from the other and still meet it.
      const reach = Math.max(...A.chain.edges) + Math.max(...B.chain.edges) + gap
      A.chain.points.forEach((p, i) => {
        const candidates = nearSegments(indexes[b], p, reach)
        if (!candidates.length) return
        const near = beside(B.chain.points, p, candidates)
        if (!near.alongside) return
        const [j, t] = [near.segment, near.t]
        const zb = B.z[j - 1] + (B.z[j] - B.z[j - 1]) * t
        if (Math.abs(zb - A.z[i]) > step) return
        const q: Point = [
          B.chain.points[j - 1][0] + (B.chain.points[j][0] - B.chain.points[j - 1][0]) * t,
          B.chain.points[j - 1][1] + (B.chain.points[j][1] - B.chain.points[j - 1][1]) * t,
        ]
        const facing = beside(A.chain.points, q, nearSegments(indexes[a], q, reach)).left ? 0 : 1
        if (near.distance > sideAt(A.chain, facing, i) + sideAt(B.chain, near.left ? 0 : 1, j - 1, t) + gap) return
        open[a][facing][i] = true
        if (!A.fixed) A.z[i] = Math.max(A.z[i], zb)
      })
    }
  return open
}

/** How far inside another deck a side must lie, in metres, and how near its height, for that side to have no parapet. */
const COVERED = { inset: 0.5, step: 1.5 }

/**
 * Per deck, the side points lying on another road deck at its height, as on a
 * junction carried by a bridge where ways cross and meet: no parapet runs
 * across a road there.
 */
export function coveredSides(decks: Array<{ chain: Chain; z: number[] }>): Sides[] {
  const roads = decks.map(({ chain }, k) => ({ k, chain, bounds: boundsOf(chain.points, Math.max(...chain.edges)), d: along(chain.points) })).filter(r => r.chain.kind === 'road')
  return decks.map(({ chain, z }, a) => {
    const out: Sides = [chain.points.map(() => false), chain.points.map(() => false)]
    if (chain.kind !== 'road') return out
    const sides = edgePoints(chain)
    for (const side of [0, 1] as const)
      sides[side].forEach((e, i) => {
        out[side][i] = roads.some(({ k, chain: other, bounds, d }) => {
          if (k === a || !holds(bounds, e)) return false
          const near = beside(other.points, e)
          if (!near.alongside) return false
          const half = sideAt(other, near.left ? 0 : 1, near.segment - 1, near.t)
          if (near.distance > half - COVERED.inset) return false
          const zb = decks[k].z[near.segment - 1] + (decks[k].z[near.segment] - decks[k].z[near.segment - 1]) * near.t
          return Math.abs(zb - z[i]) <= COVERED.step && d.length > 1
        })
      })
    return out
  })
}

/** How far past a side, in metres, a mouth is looked for: the road that carries on from it; and how often along it. */
const MOUTH_PROBE = 2
const MOUTH_STEP = 1.5

/**
 * Per deck, the side points facing a carriageway's mouth: just past them lies
 * another road deck at their height, the road carrying on from the deck. A
 * parapet there would stand across it.
 */
export function mouthSides(decks: Array<{ chain: Chain; z: number[] }>): Sides[] {
  const roads = decks.map(({ chain }, k) => ({ k, chain, bounds: boundsOf(chain.points, Math.max(...chain.edges)) })).filter(r => r.chain.kind === 'road' && r.chain.points.length > 1)
  // Probed every metre and a half along every side, a long deck read whole each time stalled the page for seconds.
  const indexes = new Map(roads.map(r => [r.k, { index: segmentIndex(r.chain.points), reach: Math.max(...r.chain.edges) + MOUTH_PROBE }]))
  return decks.map(({ chain, z }, a) => {
    const n = chain.points.length
    const out: Sides = [chain.points.map(() => false), chain.points.map(() => false)]
    if (chain.kind === 'rail') return out
    const scale = MOUTH_PROBE / metresPerUnit(chain.points[0][1])
    const near = roads.filter(r => r.k !== a && meets(r.bounds, boundsOf(chain.points, Math.max(...chain.edges) + MOUTH_PROBE)))
    if (!near.length) return out
    const faces = (c: Point, e: Point, h: number) => {
      const len = Math.hypot(e[0] - c[0], e[1] - c[1])
      if (!len) return false
      const q: Point = [e[0] + ((e[0] - c[0]) / len) * scale, e[1] + ((e[1] - c[1]) / len) * scale]
      return near.some(({ k, chain: other, bounds }) => {
        if (!holds(bounds, q)) return false
        const { index, reach } = indexes.get(k)!
        const at = beside(other.points, q, nearSegments(index, q, reach))
        if (!at.alongside || at.distance > sideAt(other, at.left ? 0 : 1, at.segment - 1, at.t) - COVERED.inset) return false
        const zb = decks[k].z[at.segment - 1] + (decks[k].z[at.segment] - decks[k].z[at.segment - 1]) * at.t
        return Math.abs(zb - h) <= COVERED.step
      })
    }
    const lerp = (p: Point, q: Point, t: number): Point => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]
    const d = along(chain.points)
    edgePoints(chain).forEach((side, s) => {
      for (let i = 0; i < n; i++) if (faces(chain.points[i], side[i], z[i])) out[s][i] = true
      // A mouth narrower than the samples are apart falls between two: its segment goes, both ends with it.
      for (let i = 1; i < n; i++) {
        const k = Math.ceil((d[i] - d[i - 1]) / MOUTH_STEP)
        for (let j = 1; j < k && !(out[s][i - 1] && out[s][i]); j++)
          if (faces(lerp(chain.points[i - 1], chain.points[i], j / k), lerp(side[i - 1], side[i], j / k), z[i - 1] + (z[i] - z[i - 1]) * (j / k)))
            out[s][i - 1] = out[s][i] = true
      }
    })
    return out
  })
}

/** How far inside a bridge's outline, in metres, a deck's side must lie for it to have no parapet: the outline is the structure's edge. */
const OUTLINE_INSET = 2

/** Metres from a point to the nearest side of any of the rings. */
function toRings(p: Point, rings: Point[][]): number {
  let best = Infinity
  for (const ring of rings)
    for (let i = 1; i < ring.length; i++) {
      const [a, b] = [ring[i - 1], ring[i]]
      const [dx, dy] = [b[0] - a[0], b[1] - a[1]]
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)))
      best = Math.min(best, Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t))
    }
  return best * metresPerUnit(p[1])
}

/**
 * Per deck, the side points lying inside its own bridge's outline, well clear of
 * its edge: a junction a bridge carries is one surface out to its outline, so
 * the only parapets are along the outline itself.
 */
export function innerSides(decks: Array<{ chain: Chain }>, outlines: Array<{ rings: Point[][]; bounds: Bounds }>): Sides[] {
  return decks.map(({ chain }) => {
    const none = chain.points.map(() => false)
    // Only a deck shaped out to its outline, and one of that outline's own: not a deck passing under it.
    const own = !chain.sides || chain.kind === 'rail' ? [] : outlines.filter(o => meets(o.bounds, boundsOf(chain.points)) &&
      chain.points.filter(p => holds(o.bounds, p) && inside(p, o.rings)).length * 2 >= chain.points.length)
    if (!own.length) return [none, none.slice()] as Sides
    return edgePoints(chain).map(side => side.map(e => own.some(o => holds(o.bounds, e) && inside(e, o.rings) && toRings(e, o.rings) > OUTLINE_INSET))) as Sides
  })
}

/**
 * Triangles for the GPU. Where `low`, `bias` and `spread` are kept, every
 * vertex has them: its colour below street zoom, metres it is drawn toward the
 * eye, and for a painted line's vertex the way out from the line's middle
 * (mercator units a metre) with its half width in metres.
 */
export type Mesh = { position: number[]; normal: number[]; color: number[]; low?: number[]; bias?: number[]; spread?: number[] }

/** A mesh that keeps low colours and biases. */
export const deckMeshOut = (): Required<Mesh> => ({ position: [], normal: [], color: [], low: [], bias: [], spread: [] })

/** One vertex onto a mesh, with its low colour and bias where the mesh keeps them. */
export function vertex(out: Mesh, p: ArrayLike<number>, n: ArrayLike<number>, color: ArrayLike<number>, low: ArrayLike<number> = color, bias = 0, spread: ArrayLike<number> = NO_SPREAD) {
  out.position.push(p[0], p[1], p[2])
  out.normal.push(n[0], n[1], n[2])
  out.color.push(color[0], color[1], color[2])
  out.low?.push(low[0], low[1], low[2])
  out.bias?.push(bias)
  out.spread?.push(spread[0], spread[1], spread[2])
}

const NO_SPREAD = [0, 0, 0]

/** Metres toward the eye a deck's surface is drawn where it lies on the ground, fading to none `fade` metres up: the drawn terrain is coarser than the deck's. */
export const TOUCHDOWN = { bias: 1.5, fade: 3 }

/** The bias for a surface `height` metres over the ground. */
export const touchdown = (height: number) => TOUCHDOWN.bias * Math.max(0, Math.min(1, 1 - height / TOUCHDOWN.fade))

/** A deck's colours: `low` is its surface's below street zoom, where roads are drawn in the basemap's colours. */
export type DeckColors = { surface: number[]; concrete: number[]; parapet: number[]; low?: number[] }

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
  piers?: number[],
  tops?: Top[],
  biasGround: number[] = groundAt,
  covered: Sides = [[], []],
): Mesh {
  const pts = chain.points
  const n = pts.length
  const scale = 1 / metresPerUnit(pts[Math.floor(n / 2)][1])
  const tangents: Point[] = []
  // Mitred sides, the mitre capped so a hairpin does not spike.
  const raw = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(n - 1, i + 1)]
    let tx = b[0] - a[0]
    let ty = b[1] - a[1]
    const len = Math.hypot(tx, ty) || 1
    tx /= len
    ty /= len
    tangents.push([tx, ty])
    let nx = -ty
    let ny = tx
    let m = 1
    if (i > 0 && i < n - 1) {
      const ux = (p[0] - a[0]) / (Math.hypot(p[0] - a[0], p[1] - a[1]) || 1)
      const uy = (p[1] - a[1]) / (Math.hypot(p[0] - a[0], p[1] - a[1]) || 1)
      const dot = nx * -uy + ny * ux
      m = 1 / Math.max(0.5, Math.abs(dot))
    }
    const at = (by: number): Point => [p[0] + nx * by * scale * m - origin[0], p[1] + ny * by * scale * m - origin[1]]
    const [l, r] = [sideAt(chain, 0, i), sideAt(chain, 1, i)]
    return { left: at(l), right: at(-r), leftOut: at(l + SEAM), rightOut: at(-r - SEAM) }
  })
  const d = along(pts)
  const caps = chain.caps ?? [0, 0, 0, 0]
  // Each side moved along the deck to its end caps: run on straight past an end, or drawn in to where its cap falls.
  const capped = (side: 'left' | 'right' | 'leftOut' | 'rightOut', start: number, end: number) => {
    const total = d[n - 1]
    return raw.map((_, i) => {
      const a = i === 0 ? start : i === n - 1 ? total - end : Math.min(Math.max(d[i], start), total - end)
      if (a === d[i]) return { p: raw[i][side], z: z[i] }
      if (a <= 0 || a >= total) {
        const k = a <= 0 ? 0 : n - 1
        const by = (a <= 0 ? a : a - total) * scale
        return { p: [raw[k][side][0] + tangents[k][0] * by, raw[k][side][1] + tangents[k][1] * by] as Point, z: z[k] }
      }
      let k = 1
      while (k < n - 1 && d[k] < a) k++
      const t = (a - d[k - 1]) / (d[k] - d[k - 1] || 1)
      const [p0, p1] = [raw[k - 1][side], raw[k][side]]
      return { p: [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t] as Point, z: z[k - 1] + (z[k] - z[k - 1]) * t }
    })
  }
  const bare = ([0, 1] as const).map(side => bareSegments(open[side].map((o, i) => o || !!covered[side][i]), d)) as [boolean[], boolean[]]
  const lefts = capped('left', caps[0], caps[2])
  const rights = capped('right', caps[1], caps[3])
  // A side shared with a neighbour runs on under it, dipping, so the two leave no seam and neither shows through the other.
  const tongues = [capped('leftOut', caps[0], caps[2]), capped('rightOut', caps[1], caps[3])].map((outer, side) =>
    outer.map((v, i) => (open[side][i] ? { p: v.p, z: v.z - SEAM_DIP } : (side ? rights : lefts)[i])))
  const h = (m: number) => m * scale
  const push = (a: number[], b: number[], c: number[], color: number[], low = color, bias: number[] = [0, 0, 0]) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    const nn = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const l = Math.hypot(nn[0], nn[1], nn[2]) || 1
    const normal = [nn[0] / l, nn[1] / l, nn[2] / l]
    ;[a, b, c].forEach((p, k) => vertex(out, p, normal, color, low, bias[k]))
  }
  const quad = (a: number[], b: number[], c: number[], d: number[], color: number[], low = color, bias = [0, 0, 0, 0]) => {
    push(a, b, c, color, low, [bias[0], bias[1], bias[2]])
    push(a, c, d, color, low, [bias[0], bias[2], bias[3]])
  }
  const at = (p: Point, metres: number) => [p[0], p[1], h(metres)]
  /** A side's point `by` metres in toward the other side. */
  const inset = (i: number, side: 'left' | 'right', by: number): Point => {
    const [p, other] = side === 'left' ? [lefts[i].p, rights[i].p] : [rights[i].p, lefts[i].p]
    const k = by / ((sideAt(chain, 0, i) + sideAt(chain, 1, i)) || 1)
    return [p[0] + (other[0] - p[0]) * k, p[1] + (other[1] - p[1]) * k]
  }
  for (let i = 1; i < n; i++) {
    const [l0, l1, r0, r1] = [lefts[i - 1], lefts[i], rights[i - 1], rights[i]]
    const [b0, b1] = [touchdown(z[i - 1] - biasGround[i - 1]), touchdown(z[i] - biasGround[i])]
    quad(at(l0.p, l0.z), at(r0.p, r0.z), at(r1.p, r1.z), at(l1.p, l1.z), colors.surface, colors.low ?? colors.surface, [b0, b0, b1, b1])
    tops?.push([l0, r0, r1, l1].map(c => [c.p[0] + origin[0], c.p[1] + origin[1], c.z]) as Top)
    if (open[0][i - 1] || open[0][i]) {
      const [o0, o1] = [tongues[0][i - 1], tongues[0][i]]
      quad(at(o0.p, o0.z), at(l0.p, l0.z), at(l1.p, l1.z), at(o1.p, o1.z), colors.surface, colors.low ?? colors.surface, [b0, b0, b1, b1])
    }
    if (open[1][i - 1] || open[1][i]) {
      const [o0, o1] = [tongues[1][i - 1], tongues[1][i]]
      quad(at(r0.p, r0.z), at(o0.p, o0.z), at(o1.p, o1.z), at(r1.p, r1.z), colors.surface, colors.low ?? colors.surface, [b0, b0, b1, b1])
    }
    // Where the deck runs at the ground it is just road: no slab or parapets.
    if (z[i - 1] - groundAt[i - 1] < BOX_MIN && z[i] - groundAt[i] < BOX_MIN) continue
    quad(at(r0.p, r0.z), at(r0.p, r0.z - SLAB), at(r1.p, r1.z - SLAB), at(r1.p, r1.z), colors.concrete)
    quad(at(l1.p, l1.z), at(l1.p, l1.z - SLAB), at(l0.p, l0.z - SLAB), at(l0.p, l0.z), colors.concrete)
    quad(at(l0.p, l0.z - SLAB), at(l1.p, l1.z - SLAB), at(r1.p, r1.z - SLAB), at(r0.p, r0.z - SLAB), colors.concrete)
    // Parapets along both edges.
    for (const side of ['left', 'right'] as const) {
      if (bare[side === 'left' ? 0 : 1][i]) continue
      const [s0, s1] = side === 'left' ? [l0, l1] : [r0, r1]
      const [i0, i1] = [inset(i - 1, side, 0.3), inset(i, side, 0.3)]
      const flip = side === 'left'
      const face = (a: number[], b: number[], c: number[], d: number[]) =>
        flip ? quad(a, b, c, d, colors.parapet) : quad(d, c, b, a, colors.parapet)
      face(at(s0.p, s0.z), at(s0.p, s0.z + PARAPET), at(s1.p, s1.z + PARAPET), at(s1.p, s1.z))
      face(at(i1, s1.z), at(i1, s1.z + PARAPET), at(i0, s0.z + PARAPET), at(i0, s0.z))
      face(at(s0.p, s0.z + PARAPET), at(i0, s0.z + PARAPET), at(i1, s1.z + PARAPET), at(s1.p, s1.z + PARAPET))
    }
  }
  // Piers where given, else wherever the deck stands high enough to need them:
  // a bent of round columns under a cap beam, a column to every BENT metres of width.
  const total = d[n - 1]
  const spaced: number[] = []
  for (let s = PIER_SPACING / 2; s < total; s += PIER_SPACING) spaced.push(s)
  for (const at_ of piers ?? spaced) {
    const top = heightAt(d, z, at_) - SLAB
    const bottom = heightAt(d, groundAt, at_) - FOOTING
    if (top - bottom < (piers ? FOOTING + CAP : PIER_MIN + FOOTING)) continue
    let k = 1
    while (k < n - 1 && d[k] < at_) k++
    const t = (at_ - d[k - 1]) / (d[k] - d[k - 1] || 1)
    const [tx, ty] = tangents[k]
    const [l, r] = [sideAt(chain, 0, k - 1, t), sideAt(chain, 1, k - 1, t)]
    // The deck's middle, between its edges, and its width there.
    const mid = (l - r) / 2
    const width = l + r
    const cx = pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * t - ty * mid * scale - origin[0]
    const cy = pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * t + tx * mid * scale - origin[1]
    const across = (m: number): Point => [cx - ty * m * scale, cy + tx * m * scale]
    const columns = Math.max(1, Math.round(width / BENT))
    const reach = Math.max(0, width / 2 - COLUMN * 2)
    for (let c = 0; c < columns; c++) {
      const [px, py] = across(columns > 1 ? -reach + (2 * reach * c) / (columns - 1) : 0)
      for (let e = 0; e < COLUMN_SIDES; e++) {
        const [a0, a1] = [(e / COLUMN_SIDES) * 2 * Math.PI, ((e + 1) / COLUMN_SIDES) * 2 * Math.PI]
        const [ax, ay, bx, by] = [Math.cos(a0), Math.sin(a0), Math.cos(a1), Math.sin(a1)].map(v => v * COLUMN * scale)
        quad([px + ax, py + ay, h(bottom)], [px + bx, py + by, h(bottom)], [px + bx, py + by, h(top)], [px + ax, py + ay, h(top)], colors.concrete)
      }
    }
    // The cap: a beam across under the slab, as wide as the deck less a little each side.
    const half = Math.max(COLUMN, width / 2 - 0.4)
    const [fx, fy] = [tx * (CAP / 2) * scale, ty * (CAP / 2) * scale]
    const [e0, e1] = [across(-half), across(half)]
    const corners = [[e0[0] - fx, e0[1] - fy], [e1[0] - fx, e1[1] - fy], [e1[0] + fx, e1[1] + fy], [e0[0] + fx, e0[1] + fy]]
    for (let c = 0; c < 4; c++) {
      const [a, b] = [corners[c], corners[(c + 1) % 4]]
      quad([a[0], a[1], h(top - CAP)], [b[0], b[1], h(top - CAP)], [b[0], b[1], h(top)], [a[0], a[1], h(top)], colors.concrete)
    }
    quad([...corners[3], h(top - CAP)], [...corners[2], h(top - CAP)], [...corners[1], h(top - CAP)], [...corners[0], h(top - CAP)], colors.concrete)
  }
  return out
}

/**
 * Per segment, by the index of its second point, whether a side has no
 * parapet: where it is shared, and on a stub shorter than PARAPET_RUN that a
 * shared stretch leaves at an end, as when twin decks part at an abutment.
 */
export function bareSegments(shared: boolean[], d: number[]): boolean[] {
  const n = d.length
  const out = d.map((_, i) => i > 0 && !!shared[i - 1] && !!shared[i])
  let i = 1
  while (i < n) {
    if (out[i]) { i++; continue }
    let j = i
    while (j < n && !out[j]) j++
    const touches = (i > 1 && out[i - 1]) || (j < n && out[j])
    const atEnd = i === 1 || j === n
    if (touches && atEnd && d[j - 1] - d[i - 1] < PARAPET_RUN) for (let k = i; k < j; k++) out[k] = true
    i = j
  }
  return out
}

/** Shortest parapet left at a deck's end beside a shared stretch, in metres. */
export const PARAPET_RUN = 15

/** Metres a deck reaches under a neighbour it is joined to, and how far below its surface that edge lies. */
export const SEAM = 0.3
const SEAM_DIP = 0.03

/** How far a grounded end may drop and rise to meet the ground drawn under it, and over how many metres the deck eases into that. */
const LANDING = { down: 1, up: 2, ease: 20 }

/** A deck's heights with each grounded end eased to the map's ground (true metres), unless that lies beyond LANDING, as in a hollow. */
export function landedOn(chain: Chain, z: number[], ground: (p: Point) => number | null): number[] {
  const n = chain.points.length
  if (n < 2) return z
  const d = along(chain.points)
  const reach = Math.min(LANDING.ease, d[n - 1] / 2)
  const out = [...z]
  for (const end of [0, 1] as const) {
    if (!chain.grounded[end]) continue
    const i = end ? n - 1 : 0
    const g = ground(chain.points[i])
    if (g === null || Number.isNaN(g)) continue
    const delta = g - z[i]
    if (delta < -LANDING.down || delta > LANDING.up) continue
    for (let k = 0; k < n; k++) {
      const from = end ? d[n - 1] - d[k] : d[k]
      if (from >= reach) continue
      const u = 1 - from / reach
      out[k] += delta * smoothstep(u)
    }
  }
  return out
}

/**
 * A deck's ends made whole: an end on the ground reaches at least to its way's
 * end, where the road takes over, and where both sides run on past an end the
 * deck carries on to there as a level stretch of road, so what is laid on it
 * follows it out to the ground at its tip. `shift` is how far the start moved back, in metres.
 */
export function endsMade(chain: Chain, z: number[], groundAt: number[], ground?: (p: Point) => number | null): { chain: Chain; z: number[]; groundAt: number[]; shift: number } {
  if (!chain.caps || chain.points.length < 2) return { chain, z, groundAt, shift: 0 }
  const caps = chain.caps.map((c, k) => (chain.grounded[k >> 1] ? Math.min(c, 0) : c)) as [number, number, number, number]
  const runs = [Math.max(0, -Math.max(caps[0], caps[1])), Math.max(0, -Math.max(caps[2], caps[3]))]
  let { points } = chain
  let [zs, gs, sides] = [z, groundAt, chain.sides]
  const n = points.length
  const scale = metresPerUnit(points[0][1])
  // The tip meets the ground drawn there, within RUN_ON_STEP of the deck's end height.
  const landed = (tip: Point, end: number) => {
    const g = ground?.(tip)
    return g === null || g === undefined || Number.isNaN(g) || Math.abs(g - end) > RUN_ON_STEP ? end : g
  }
  const out = (end: 0 | 1) => {
    const [a, b] = end ? [points[n - 2], points[n - 1]] : [points[1], points[0]]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) * scale || 1
    return [b, ((b[0] - a[0]) * runs[end]) / len, ((b[1] - a[1]) * runs[end]) / len] as const
  }
  if (runs[1] >= RUN_ON_MIN) {
    const [b, dx, dy] = out(1)
    const tip: Point = [b[0] + dx, b[1] + dy]
    const at = landed(tip, zs[n - 1])
    points = [...points, tip]
    zs = [...zs, at]
    gs = [...gs, chain.grounded[1] ? at : gs[n - 1]]
    sides = sides && [[...sides[0], sides[0][n - 1]], [...sides[1], sides[1][n - 1]]]
    caps[2] += runs[1]
    caps[3] += runs[1]
  }
  if (runs[0] >= RUN_ON_MIN) {
    const [b, dx, dy] = out(0)
    const tip: Point = [b[0] + dx, b[1] + dy]
    const at = landed(tip, zs[0])
    points = [tip, ...points]
    zs = [at, ...zs]
    gs = [chain.grounded[0] ? at : gs[0], ...gs]
    sides = sides && [[sides[0][0], ...sides[0]], [sides[1][0], ...sides[1]]]
    caps[0] += runs[0]
    caps[1] += runs[0]
  }
  const shift = runs[0] >= RUN_ON_MIN ? runs[0] : 0
  return { chain: { ...chain, points, caps, ...(sides ? { sides } : {}) }, z: zs, groundAt: gs, shift }
}

/** Shortest stretch, in metres, a deck is carried on past its end as road, and the most its tip moves to meet the ground. */
const RUN_ON_MIN = 0.5
const RUN_ON_STEP = 1.5

/** A polygon cut to the side of a line through `o` that `n` points to (Sutherland-Hodgman). */
export function halfPlane(poly: Point[], o: Point, n: Point): Point[] {
  const side = (p: Point) => (p[0] - o[0]) * n[0] + (p[1] - o[1]) * n[1]
  const out: Point[] = []
  for (let i = 0; i < poly.length; i++) {
    const [a, b] = [poly[i], poly[(i + 1) % poly.length]]
    const [sa, sb] = [side(a), side(b)]
    if (sa >= 0) out.push(a)
    if ((sa >= 0) !== (sb >= 0)) {
      const t = sa / (sa - sb)
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    }
  }
  return out
}

/** Whether a point lies inside a polygon's rings, by the even-odd rule. */
export function inside([x, y]: Point, rings: Point[][]): boolean {
  let hit = false
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [[xi, yi], [xj, yj]] = [ring[i], ring[j]]
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
    }
  return hit
}

/** Most a curve turns between two vertices of a drawn deck, in radians. */
export const ROUND_TURN = (3 * Math.PI) / 180
/** Most pieces a segment is split into to round a curve. */
const ROUND_MAX = 4

/**
 * A deck with its curves filled in, for drawing: each segment beside a vertex
 * where the deck turns is split into pieces turning no more than ROUND_TURN,
 * along a cubic through its vertices with each one's tangent taken from its
 * neighbours by distance, so a short chord beside a long one does not
 * overshoot. Heights follow the same curve; ground and edges run straight
 * between vertices.
 */
export function rounded(chain: Chain, z: number[], groundAt: number[]): { chain: Chain; z: number[]; groundAt: number[] } {
  const pts = chain.points
  const n = pts.length
  if (n < 3) return { chain, z, groundAt }
  const turn = pts.map((p, i) => {
    if (i === 0 || i === n - 1) return 0
    const [a, b] = [pts[i - 1], pts[i + 1]]
    const [ux, uy, vx, vy] = [p[0] - a[0], p[1] - a[1], b[0] - p[0], b[1] - p[1]]
    return Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy))
  })
  const pieces = pts.slice(1).map((_, i) => Math.min(ROUND_MAX, Math.max(1, Math.ceil(Math.max(turn[i], turn[i + 1]) / ROUND_TURN))))
  if (pieces.every(k => k === 1)) return { chain, z, groundAt }
  const d = along(pts)
  // Change per metre along the deck at each vertex, from its neighbours.
  const slope = (values: (i: number) => number, i: number) => {
    const [a, b] = [Math.max(0, i - 1), Math.min(n - 1, i + 1)]
    return (values(b) - values(a)) / (d[b] - d[a] || 1)
  }
  const channels = [(i: number) => pts[i][0], (i: number) => pts[i][1], (i: number) => z[i]]
  const tangents = channels.map(values => pts.map((_, i) => slope(values, i)))
  const hermite = (c: number, i: number, t: number) => {
    const length = d[i + 1] - d[i]
    const [v0, v1] = [channels[c](i), channels[c](i + 1)]
    const [m0, m1] = [tangents[c][i] * length, tangents[c][i + 1] * length]
    const [t2, t3] = [t * t, t * t * t]
    return (2 * t3 - 3 * t2 + 1) * v0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * v1 + (t3 - t2) * m1
  }
  const out = { points: [pts[0]] as Point[], z: [z[0]], groundAt: [groundAt[0]], sides: [[sideAt(chain, 0, 0)], [sideAt(chain, 1, 0)]] as [number[], number[]] }
  pieces.forEach((k, i) => {
    for (let j = 1; j <= k; j++) {
      const t = j / k
      out.points.push(j === k ? pts[i + 1] : [hermite(0, i, t), hermite(1, i, t)])
      out.z.push(j === k ? z[i + 1] : hermite(2, i, t))
      out.groundAt.push(groundAt[i] + (groundAt[i + 1] - groundAt[i]) * t)
      for (const side of [0, 1] as const) out.sides[side].push(sideAt(chain, side, i, t))
    }
  })
  return { chain: { ...chain, points: out.points, ...(chain.sides ? { sides: out.sides } : {}) }, z: out.z, groundAt: out.groundAt }
}

/** A drawn segment of a deck's top: its four corners, as mercator x, y and metres up. */
export type Top = [number[], number[], number[], number[]]

/** The height of a deck's drawn top over a point, from the two triangles of its segment `i` (as `deckMesh` splits it); null outside both. */
export function topZ(deck: DeckSurface, i: number, p: Point): number | null {
  // The nearest centreline segment is not always the drawn one over a point at a bend or a skewed end.
  for (const j of [i, i - 1, i + 1]) {
    const q = deck.tops?.[j - 1]
    if (!q) continue
    for (const [a, b, c] of [[q[0], q[1], q[2]], [q[0], q[2], q[3]]]) {
      const w = barycentric(a, b, c, p)
      if (w && w[0] >= -1e-6 && w[1] >= -1e-6 && w[0] + w[1] <= 1 + 1e-6) return w[0] * a[2] + w[1] * b[2] + (1 - w[0] - w[1]) * c[2]
    }
  }
  return null
}

/** A point's weights on a triangle's first two corners (the third takes the rest); null for a flat triangle. */
function barycentric(a: number[], b: number[], c: number[], p: Point): [number, number] | null {
  const det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
  if (!det) return null
  return [((b[1] - c[1]) * (p[0] - c[0]) + (c[0] - b[0]) * (p[1] - c[1])) / det, ((c[1] - a[1]) * (p[0] - c[0]) + (a[0] - c[0]) * (p[1] - c[1])) / det]
}

/** The height of the plane through three points (x, y, z) over a point. */
export function planeOf(a: number[], b: number[], c: number[]): (p: Point) => number {
  return p => {
    const w = barycentric(a, b, c, p)
    return w ? w[0] * a[2] + w[1] * b[2] + (1 - w[0] - w[1]) * c[2] : (a[2] + b[2] + c[2]) / 3
  }
}

/** The inward normal of each edge of a convex polygon, by its first point; none for an edge of no length. */
function insides(convex: Point[]): Array<[Point, Point]> {
  const centre: Point = [convex.reduce((a, p) => a + p[0], 0) / convex.length, convex.reduce((a, p) => a + p[1], 0) / convex.length]
  return convex.flatMap((a, e) => {
    const b = convex[(e + 1) % convex.length]
    let n: Point = [-(b[1] - a[1]), b[0] - a[0]]
    if (!n[0] && !n[1]) return []
    if ((centre[0] - a[0]) * n[0] + (centre[1] - a[1]) * n[1] < 0) n = [-n[0], -n[1]]
    return [[a, n]]
  })
}

/** A polygon cut to a convex one. */
export function convexClip(poly: Point[], convex: Point[]): Point[] {
  return insides(convex).reduce((out, [a, n]) => (out.length >= 3 ? halfPlane(out, a, n) : out), poly)
}

/** A convex polygon less a convex one, as convex pieces that do not overlap. */
export function subtractConvex(poly: Point[], hole: Point[]): Point[][] {
  const out: Point[][] = []
  let rest = poly
  for (const [a, n] of insides(hole)) {
    if (rest.length < 3) break
    const outside = halfPlane(rest, a, [-n[0], -n[1]])
    if (outside.length >= 3) out.push(outside)
    rest = halfPlane(rest, a, n)
  }
  return out
}

/**
 * A solved deck as things are laid on it; `bias` per point and `low` as in `Mesh`, `ground` beneath each point,
 * `sidewalks` where its top beside its carriageway is already drawn as walkway.
 */
export type DeckSurface = { points: Point[]; z: number[]; d: number[]; width: number; bounds?: Bounds; bias?: number[]; low?: number[]; ground?: number[]; kind?: Piece['kind']; edges?: [Point[], Point[]]; tops?: Top[]; sidewalks?: boolean }

/** A point over a deck: which deck, how far off its centreline, its height there, and the segment beneath. */
export type Hit = { deck: number; distance: number; z: number; segment: number; t: number }

/** Every deck segment by grid cell, grown by its deck's half width: each point looks only in its own cell. */
type SurfaceIndex = { cell: number; cells: Map<number, Array<[number, number]>> }

const surfaceIndexes = new WeakMap<DeckSurface[], SurfaceIndex>()

function surfaceIndex(decks: DeckSurface[]): SurfaceIndex {
  let index = surfaceIndexes.get(decks)
  if (index) return index
  const cell = INDEX_CELL / metresPerUnit(decks[0]?.points[0]?.[1] ?? 0.5)
  const cells = new Map<number, Array<[number, number]>>()
  decks.forEach((deck, k) => {
    const pad = (deck.width / 2 + 0.5) / metresPerUnit(deck.points[0][1])
    for (let i = 1; i < deck.points.length; i++) {
      const [a, b] = [deck.points[i - 1], deck.points[i]]
      for (let x = Math.floor((Math.min(a[0], b[0]) - pad) / cell); x <= Math.floor((Math.max(a[0], b[0]) + pad) / cell); x++)
        for (let y = Math.floor((Math.min(a[1], b[1]) - pad) / cell); y <= Math.floor((Math.max(a[1], b[1]) + pad) / cell); y++) {
          const list = cells.get(cellKey(x, y))
          if (list) list.push([k, i])
          else cells.set(cellKey(x, y), [[k, i]])
        }
    }
  })
  surfaceIndexes.set(decks, (index = { cell, cells }))
  return index
}

/** The decks under a point, each at its nearest segment. */
function hitsAt(decks: DeckSurface[], p: Point): Hit[] {
  const { cell, cells } = surfaceIndex(decks)
  const scale = metresPerUnit(p[1])
  const best = new Map<number, Hit>()
  for (const [k, i] of cells.get(cellKey(Math.floor(p[0] / cell), Math.floor(p[1] / cell))) ?? []) {
    const deck = decks[k]
    const [a, b] = [deck.points[i - 1], deck.points[i]]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)))
    const distance = Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]) * scale
    if (distance < deck.width / 2 + 0.5 && distance < (best.get(k)?.distance ?? Infinity))
      best.set(k, { deck: k, distance, z: topZ(deck, i, p) ?? deck.z[i - 1] + (deck.z[i] - deck.z[i - 1]) * t, segment: i, t })
  }
  return [...best.values()].sort((a, b) => a.deck - b.deck)
}

function hitsUnder(points: Point[], decks: DeckSurface[]): Hit[][] {
  return decks.length ? points.map(p => hitsAt(decks, p)) : points.map(() => [])
}

const nearest = (hits: Hit[]) => hits.reduce((a, b) => (b.distance < a.distance ? b : a))

/** A value kept per point of a deck (its bias, its ground), where a hit lies. */
export function atHit(values: number[] | undefined, hit: Hit): number {
  if (!values) return 0
  return values[hit.segment - 1] + (values[hit.segment] - values[hit.segment - 1]) * hit.t
}

/** Points lifted `lift` metres onto the deck nearest beneath each, other than `skip`, or null off every deck. */
export function onDeck(points: Point[], decks: DeckSurface[], lift: number, skip = -1): Array<number | null> {
  return hitsUnder(points, decks).map(all => {
    const hits = all.filter(h => h.deck !== skip)
    return hits.length ? nearest(hits).z + lift : null
  })
}

/** Degrees past the best-aligned deck that another may stray from a mark's heading and still run its way. */
const ALIGNED = 12

/** The hits whose deck runs the way of the step (dx, dy), or across it. */
function runningWith(hits: Hit[], decks: DeckSurface[], dx: number, dy: number, across: boolean): Hit[] {
  const length = Math.hypot(dx, dy)
  if (hits.length < 2 || !length) return hits
  const off = hits.map(hit => {
    const [a, b] = [decks[hit.deck].points[hit.segment - 1], decks[hit.deck].points[hit.segment]]
    const cos = Math.min(1, Math.abs((dx * (b[0] - a[0]) + dy * (b[1] - a[1])) / (length * (Math.hypot(b[0] - a[0], b[1] - a[1]) || 1))))
    const angle = (Math.acos(cos) * 180) / Math.PI
    return across ? 90 - angle : angle
  })
  const best = Math.min(...off)
  return hits.filter((_, i) => off[i] <= best + ALIGNED)
}

/** Metres within which a line that follows a centreline counts two decks as equally near. */
const CENTRED_TIE = 0.25

/**
 * One mark's lines and rings lifted onto the deck it belongs to where decks
 * cross or stack: the nearest deck running its way, never a jump between levels.
 * A `centred` line, such as a route, follows whichever centreline it is on.
 * `under` says which deck each point was laid on, and where.
 */
export function onOwnDeck(
  lines: Point[][],
  rings: Point[][],
  decks: DeckSurface[],
  { across = false, centred = false }: { across?: boolean; centred?: boolean } = {},
): Record<'lines' | 'rings', Array<Array<number | null>>> & { under: Record<'lines' | 'rings', Array<Array<Hit | null>>> } {
  const all = [...lines, ...rings]
  const hits = all.map(line => hitsUnder(line, decks))
  const split = <T>(v: T[]) => ({ lines: v.slice(0, lines.length), rings: v.slice(lines.length) })
  const result = (laid: Array<Array<Hit | null>>) => ({ ...split(laid.map(line => line.map(h => h?.z ?? null))), under: split(laid) })
  if (hits.every(line => line.every(h => h.length < 2))) return result(hits.map(line => line.map(h => h[0] ?? null)))
  const votes = new Map<number, number>()
  for (const [l, line] of all.entries())
    for (let i = 1; i < line.length; i++) {
      const both = hits[l][i].filter(h => hits[l][i - 1].some(g => g.deck === h.deck))
      if (!both.length) continue
      const { deck } = nearest(runningWith(both, decks, line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1], across))
      votes.set(deck, (votes.get(deck) ?? 0) + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]))
    }
  const owner = votes.size ? [...votes].reduce((a, b) => (b[1] > a[1] ? b : a))[0] : -1
  return result(all.map((line, l) => {
    // A ring's corners have no heading of their own; a line's points keep to the decks running their way.
    const candidates = l >= lines.length ? hits[l] : hits[l].map((h, i) => {
      const [a, b] = [line[Math.max(0, i - 1)], line[Math.min(line.length - 1, i + 1)]]
      return runningWith(h, decks, b[0] - a[0], b[1] - a[1], across)
    })
    const laid: Array<Hit | null> = line.map(() => null)
    const lay = (i: number, last: number | null) => {
      let here = candidates[i]
      if (!here.length) return last
      if (centred) {
        const closest = nearest(here).distance
        here = here.filter(h => h.distance <= closest + CENTRED_TIE)
      }
      const own = here.find(h => h.deck === owner)
      laid[i] = own ?? (last === null ? nearest(here) : here.reduce((a, b) => (Math.abs(b.z - last) < Math.abs(a.z - last) ? b : a)))
      return laid[i]!.z
    }
    const start = Math.max(0, candidates.findIndex(here => here.some(h => h.deck === owner)))
    let last: number | null = null
    for (let i = start; i < line.length; i++) last = lay(i, last)
    last = laid[start]?.z ?? null
    for (let i = start - 1; i >= 0; i--) last = lay(i, last)
    return laid
  }))
}

/** Metres past a deck's edge an object may stand and still be on it, and how closely a linear one must run with it, as a cosine. */
const STAND_SLACK = 0.5
const STAND_ALIGNED = Math.cos((25 * Math.PI) / 180)

/**
 * The deck an object at `p` stands on: the surface's height there and how far
 * it stands over the ground, from the deck whose centreline is nearest. A
 * linear object (`along`, east and south) only stands on a deck it runs with.
 */
export function standing(decks: Array<{ chain: Chain; surface: DeckSurface }>, p: Point, along?: [number, number]): { z: number; height: number } | null {
  let best: { z: number; height: number; distance: number } | null = null
  for (const { chain, surface } of decks) {
    if (surface.bounds && !holds(surface.bounds, p)) continue
    const near = beside(chain.points, p)
    if (!near.alongside || near.distance > sideAt(chain, near.left ? 0 : 1, near.segment - 1, near.t) + STAND_SLACK) continue
    if (best && near.distance >= best.distance) continue
    const [a, b] = [chain.points[near.segment - 1], chain.points[near.segment]]
    if (along && Math.abs(along[0] * (b[0] - a[0]) + along[1] * (b[1] - a[1])) < STAND_ALIGNED * Math.hypot(along[0], along[1]) * (Math.hypot(b[0] - a[0], b[1] - a[1]) || 1)) continue
    const at = (v: number[]) => v[near.segment - 1] + (v[near.segment] - v[near.segment - 1]) * near.t
    best = { z: at(surface.z), height: at(surface.z) - at(surface.ground ?? surface.z), distance: near.distance }
  }
  return best && { z: best.z, height: best.height }
}

/** A way near a deck, and its half width in metres. */
export type UnderWay = { points: Point[]; half: number; bounds: Bounds }

/** Whether a linear object (`along`, east and south) runs with one of the ways, within `reach` metres of its edge. */
export function runsWith(ways: UnderWay[], p: Point, along: [number, number], reach: number): boolean {
  return ways.some(w => {
    if (!holds(w.bounds, p)) return false
    const near = beside(w.points, p)
    if (near.distance > w.half + reach) return false
    const [a, b] = [w.points[near.segment - 1], w.points[near.segment]]
    return Math.abs(along[0] * (b[0] - a[0]) + along[1] * (b[1] - a[1])) >= STAND_ALIGNED * Math.hypot(along[0], along[1]) * (Math.hypot(b[0] - a[0], b[1] - a[1]) || 1)
  })
}

/** Whether an object over a deck is a way's under it: a linear one running with it, a point one beside it but not over it. */
export function underWay(ways: UnderWay[], p: Point, along?: [number, number]): boolean {
  if (along) return runsWith(ways, p, along, UNDER_SLACK)
  return ways.some(w => {
    if (!holds(w.bounds, p)) return false
    const { distance } = beside(w.points, p)
    return distance > w.half && distance <= w.half + UNDER_SLACK
  })
}

/** Metres beside a way under a deck that are its, not the deck's. */
export const UNDER_SLACK = 3

/** A key that changes when the decks things stand on do. */
export const standKey = (decks: Array<{ surface: DeckSurface }>) =>
  decks.map(({ surface: s }) => `${s.points.length}:${s.points[0]}:${s.z.reduce((a, b) => a + b, 0).toFixed(1)}`).join('|')

/** A profile served as decimetres joined by commas, in metres. */
export function parseProfile(text: unknown): number[] {
  return typeof text === 'string' && text ? text.split(',').map(v => Number(v) / 10) : []
}

/** A served deck's exact samples: the first as lng,lat and each after as a step from the last, in 1e-7 degrees. */
export function parseLine(text: unknown): Array<[number, number]> {
  if (typeof text !== 'string' || !text) return []
  let [x, y] = [0, 0]
  return text.split(';').map(pair => {
    const [dx, dy] = pair.split(',').map(Number)
    ;[x, y] = [x + dx, y + dy]
    return [x / 1e7, y / 1e7] as [number, number]
  })
}

/**
 * A served deck's shape where it follows its bridge outline (format 2): each
 * side's edge at every sample, and its end caps. Nothing for an older row, or
 * one that does not match its samples.
 */
export function parseShape(props: Record<string, any>, samples: number): Pick<Chain, 'sides' | 'caps'> {
  if (Number(props.format) < 2) return {}
  const sides = [parseProfile(props.left_edges), parseProfile(props.right_edges)] as [number[], number[]]
  const caps = parseProfile(props.caps)
  if (sides.some(s => s.length !== samples)) return {}
  return { sides, ...(caps.length === 4 ? { caps: caps as [number, number, number, number] } : {}) }
}

/** Whether most of a piece lies on one of the given decks, so it is drawn already. */
export function covered(piece: Piece, decks: Array<{ chain: Chain; bounds: Bounds }>): boolean {
  const rail = piece.kind === 'rail'
  const on = piece.points.filter(p => decks.some(({ chain: d, bounds }) => {
    if (!holds(bounds, p)) return false
    if ((d.kind === 'rail') === rail) return beside(d.points, p).distance < Math.max(...d.edges) + COVER
    // A tram in a road bridge's carriageway is carried on its deck.
    return rail && d.kind === 'road' && d.layer === piece.layer && beside(d.points, p).distance <= Math.max(...d.edges)
  }))
  return on.length * 2 >= piece.points.length
}

/** How far beyond a served deck's edge a basemap bridge may lie and still be the same bridge, in metres. */
export const COVER = 3

/**
 * A line's left and right edges, `edges` metres out, relative to `origin`.
 * Mitred at each vertex, the mitre capped so a hairpin does not spike.
 */
export function outline(pts: Point[], edges: [number, number], origin: Point): Array<{ left: Point; right: Point }> {
  const n = pts.length
  const scale = 1 / metresPerUnit(pts[Math.floor(n / 2)][1])
  const [toLeft, toRight] = edges.map(e => e * scale)
  return pts.map((p, i) => {
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
}

/** A triangle onto a mesh, flat-shaded by its winding. */
export function triangle(out: Mesh, a: number[], b: number[], c: number[], color: number[]) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  const nn = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
  const l = Math.hypot(nn[0], nn[1], nn[2]) || 1
  for (const p of [a, b, c]) vertex(out, p, [nn[0] / l, nn[1] / l, nn[2] / l], color)
}

/** Two triangles, a-b-c and a-c-d. */
export function quad(out: Mesh, a: number[], b: number[], c: number[], d: number[], color: number[]) {
  triangle(out, a, b, c, color)
  triangle(out, a, c, d, color)
}

/** A longitude and latitude for a web-mercator point. */
export function unprojected([x, y]: Point): [number, number] {
  return [x * 360 - 180, (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI]
}

/** A web-mercator point, 0-1 across the world, for a longitude and latitude. */
export function mercator([lng, lat]: number[]): Point {
  const s = Math.sin((lat * Math.PI) / 180)
  return [(lng + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)]
}

/** The bounds of the tile a queried feature came from, or null if it does not say. */
export function tileBounds(feature: any): Bounds | null {
  const { _x: x, _y: y, _z: z } = feature
  if (typeof x !== 'number' || typeof z !== 'number') return null
  const n = 2 ** z
  return { minX: x / n, minY: y / n, maxX: (x + 1) / n, maxY: (y + 1) / n }
}

export const polygonsOf = (geometry: any): number[][][][] =>
  geometry?.type === 'Polygon' ? [geometry.coordinates]
  : geometry?.type === 'MultiPolygon' ? geometry.coordinates
  : []

export const linesOf = (geometry: any): number[][][] =>
  geometry?.type === 'LineString' ? [geometry.coordinates]
  : geometry?.type === 'MultiLineString' ? geometry.coordinates
  : []
