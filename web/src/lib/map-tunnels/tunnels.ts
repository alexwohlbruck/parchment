/**
 * Road tunnels in 3D: the geometry behind their portals.
 *
 * A tunnel runs under the terrain, where nothing of it shows but its portals.
 * Each portal is drawn as the cut leading down to it — a ramp between retaining
 * walls, the headwall over the opening, and the first stretch of the bore going
 * dark — inside a hole the layer masks out of the terrain (see `tunnel-layer.ts`).
 *
 * Pure functions, in Web Mercator units for position and metres for height.
 */
import { MAX_GRADE, along, densify, metresPerUnit, outline, quad, type Mesh, type Point } from '@/lib/map-decks/decks'

/** Clear height inside a road's bore, and the roof over any bore, in metres. */
export const HEADROOM = 4.6
export const ROOF = 0.8

export type BoreKind = 'road' | 'path' | 'rail'

/**
 * What goes through a bore sets its section: headroom in metres, the steepest
 * its approach climbs as a grade, and how far out a cut to it may run.
 */
export type BoreProfile = { headroom: number; grade: number; reach: number }

export const PROFILES: Record<BoreKind, BoreProfile> = {
  road: { headroom: HEADROOM, grade: MAX_GRADE, reach: 160 },
  path: { headroom: 2.6, grade: 0.08, reach: 100 },
  // Room for overhead wire, and the gentle climb a train can take.
  rail: { headroom: 5.5, grade: 0.035, reach: 300 },
}
/** The kerb between a carriageway and the wall beside it, in metres. */
export const KERB = 0.6
/** The least depth a cut is drawn at, in metres; shallower, the road is at grade. */
export const OPEN = 0.8
/** How far past a wall the ground it holds back is read, in metres. */
export const RIM = [0.8, 1.2, 1.6]
/** Where the ground over a bore is read, in metres in from its portal. */
export const COVER_AT = [10, 15, 20]
/** Metres of bore drawn in from a portal, past where any light reaches. */
export const BORE = 40
/** Farthest any cut runs out from its portal, in metres. */
export const CUT_MAX = Math.max(...Object.values(PROFILES).map(p => p.reach))
/** The most a headwall rises over a portal's roof, in metres; above it the hillside carries on. */
export const FACADE = 4
/** The shortest forecourt a portal is given, in metres, so a mouth in a hillside has walls to stand in. */
export const FORECOURT = 9
/** The least the ground must stand over a portal, beside it or above the bore, for a cut to be dug, in metres. */
export const RELIEF = 2
/** How far behind a headwall the ground its top meets is read, in metres. */
const BEHIND = 6
/** Metres along which a wall's top follows the lowest ground beside it. */
const RIM_SPAN = 4
/** How far out from a portal the ground it opens onto is read, in metres. */
const MOUTH_SPAN = 9
/** Sharpest turn, in radians, from one way onto the next that still carries the same road. */
const STRAIGHT_ON = Math.PI / 3

const near = (a: Point, b: Point, tolerance: number) => Math.abs(a[0] - b[0]) < tolerance && Math.abs(a[1] - b[1]) < tolerance

const heading = (a: Point, b: Point): Point => {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
  return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]
}

const turn = (a: Point, b: Point) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1])))

/** A line cut short `metres` along it. */
export function truncate(points: Point[], metres: number): Point[] {
  const d = along(points)
  const out: Point[] = [points[0]]
  for (let i = 1; i < points.length; i++) {
    if (d[i] < metres) {
      out.push(points[i])
      continue
    }
    const t = (metres - d[i - 1]) / (d[i] - d[i - 1] || 1)
    out.push([points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t, points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t])
    break
  }
  return out
}

export type Approach = {
  /** From the portal outward. */
  points: Point[]
  /** Whether it ends at a junction, rather than where the loaded roads or the length run out. */
  junction: boolean
}

/**
 * The road a portal opens onto, from the portal outward for up to `length`
 * metres. It follows the way that carries straight on from the tunnel, and
 * stops where the road reaches a junction or turns off. `roads` are the
 * at-grade lines around, `inward` the tunnel's next point in from the portal,
 * `tolerance` in mercator units.
 */
export function approach(portal: Point, inward: Point, roads: Point[][], tolerance: number, length = CUT_MAX): Approach {
  const used = new Set<number>()
  const out: Point[] = [portal]
  let direction = heading(inward, portal)
  let junction = false
  for (;;) {
    const end = out[out.length - 1]
    const meeting: Array<{ index: number; line: Point[] }> = []
    let through = false
    roads.forEach((line, index) => {
      if (used.has(index) || line.length < 2) return
      if (near(line[0], end, tolerance)) meeting.push({ index, line })
      else if (near(line[line.length - 1], end, tolerance)) meeting.push({ index, line: [...line].reverse() })
      else if (line.some(p => near(p, end, tolerance))) through = true
    })
    const ways = meeting
      .map(m => ({ ...m, turn: turn(direction, heading(m.line[0], m.line[1])) }))
      .sort((a, b) => a.turn - b.turn)
    // Pieces carrying straight on are one road, however the tiles split it;
    // past the portal, one turning off is a junction.
    junction = out.length > 1 && (through || ways.some(w => w.turn > STRAIGHT_ON))
    const next = ways[0]
    if (!next || junction) break
    junction = next.turn > STRAIGHT_ON
    if (junction) break
    used.add(next.index)
    out.push(...next.line.slice(1))
    direction = heading(next.line[next.line.length - 2], next.line[next.line.length - 1])
    if (along(out).at(-1)! >= length) break
  }
  return { points: out.length < 2 ? out : truncate(out, length), junction }
}

/**
 * A carriageway's edges, read off the road surfaces drawn around it: at each
 * point the nearest outline crossed going left and going right, then the
 * median of each. Null where no surface lies beside the line.
 */
export function measureEdges(line: Point[], rings: Point[][], reach = 12): [number, number] | null {
  const lefts: number[] = []
  const rights: number[] = []
  const scale = metresPerUnit(line[0][1])
  line.forEach((p, i) => {
    const [tx, ty] = heading(line[Math.max(0, i - 1)], line[Math.min(line.length - 1, i + 1)])
    const [nx, ny] = [-ty, tx]
    let [left, right] = [Infinity, Infinity]
    for (const ring of rings)
      for (let k = 1; k < ring.length; k++) {
        const [a, b] = [ring[k - 1], ring[k]]
        const [ex, ey] = [b[0] - a[0], b[1] - a[1]]
        const det = nx * -ey + ny * ex
        if (Math.abs(det) < 1e-18) continue
        const [qx, qy] = [a[0] - p[0], a[1] - p[1]]
        const u = (qx * -ey + qy * ex) / det
        const v = (nx * qy - ny * qx) / det
        if (v < 0 || v > 1) continue
        const metres = u * scale
        if (metres > 0) left = Math.min(left, metres)
        else right = Math.min(right, -metres)
      }
    if (left <= reach && right <= reach) {
      lefts.push(left)
      rights.push(right)
    }
  })
  if (!lefts.length) return null
  const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)]
  return [median(lefts), median(rights)]
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

/**
 * A portal moved out along its approach to where the approach leaves the
 * buildings over it, the covered stretch joining the bore, so the mouth opens
 * at a building's face. Null where the whole approach is covered.
 */
export function emerge(out: Point[], bore: Point[], covered: (p: Point) => boolean, step = 1): { out: Point[]; bore: Point[] } | null {
  if (!covered(out[0])) return { out, bore }
  const dense = densify(out, step)
  const k = dense.findIndex(p => !covered(p))
  if (k < 0 || k === dense.length - 1) return null
  return { out: dense.slice(k), bore: [...dense.slice(0, k + 1).reverse(), ...bore.slice(1)] }
}

export type Cut = {
  /** Road height at each vertex. */
  floor: number[]
  /** Height of the top of the left and right walls at each vertex up to the portal. */
  walls: [number[], number[]]
  /** The vertex the cut opens at: out from it, the road runs at grade. */
  open: number
  /** The top of the headwall over the portal. */
  crown: number
  /** Clear height inside the bore. */
  headroom: number
}

/**
 * The cut down to a portal, in metres. The line runs from the far end of the
 * approach (vertex 0) to the portal (`at`) and on into the bore; `ground` is
 * under it, `beside` the ground past each wall, `cover` the ground over the
 * bore.
 *
 * Null where the ground stands no higher around the portal than at it: the
 * road goes in at grade, under a building or a deck, and there is no cut.
 *
 * The portal sits low enough to keep headroom under the cover, or lower where
 * the ground already dips. From it the floor climbs no steeper than a road may
 * until it meets the ground, and more steeply where the road reaches a
 * `junction` first, so it meets the ground there. The cut opens where the
 * floor has met the ground and is nearly level with the higher rim, and no
 * nearer than a forecourt's length. The headwall stops at the ground behind it.
 */
export function solveCut(d: number[], at: number, ground: number[], beside: [number[], number[]], cover: number, junction = true, profile = PROFILES.road): Cut | null {
  const { headroom, grade } = profile
  // The lowest ground near each stretch of wall, so the ground beside never dips below its top.
  const rims = beside.map(rim => rim.map((_, i) => Math.min(...rim.filter((__, k) => Math.abs(d[k] - d[i]) <= RIM_SPAN / 2))))
  // Read off the ground just out from the portal too: the sample at it can land on the slope into the bore.
  const mouth = Math.min(...ground.filter((_, i) => i <= at && d[at] - d[i] <= MOUTH_SPAN))
  if (Math.max(cover, rims[0][at], rims[1][at]) - mouth < Math.min(RELIEF, (headroom + ROOF) / 2)) return null
  const portal = Math.min(ground[at], cover - headroom - ROOF)
  const out = (i: number) => d[at] - d[i]
  const floorAt = (grade: number) => ground.map((g, i) => (i > at ? portal : Math.min(g, portal + grade * out(i))))
  // Still in the cut while the floor is below the road's ground or either wall is high.
  const deep = (floor: number[], i: number) => floor[i] < ground[i] - 0.05 || Math.max(rims[0][i], rims[1][i]) - floor[i] >= OPEN
  let floor = floorAt(grade)
  if (junction && at > 0 && deep(floor, 0)) floor = floorAt(Math.max(grade, (ground[0] - portal) / (out(0) || 1)))
  let open = at
  while (open > 0 && deep(floor, open)) open--
  const behind = Math.min(...ground.filter((_, i) => i > at && d[i] - d[at] <= BEHIND))
  const crown = Math.max(portal + headroom + ROOF, Math.min(behind, portal + headroom + ROOF + FACADE))
  if (portal === ground[at]) while (open > 0 && d[at] - d[open] < FORECOURT) open--
  const walls = rims.map(rim => floor.map((f, i) => (i > at ? f + headroom + ROOF : i <= open ? f : Math.max(rim[i], f)))) as [number[], number[]]
  return { floor, walls, open, crown, headroom }
}

export type PortalColors = { surface: number[]; concrete: number[]; parapet: number[]; bore: number[] }

export type PortalMesh = {
  /** The retaining walls and the headwall, standing in the cut carved into the terrain. */
  walls: Mesh
  /** The opening in the headwall, through which the bore is drawn. */
  mouth: Mesh
  /** The bore going dark, drawn only through its mouth. */
  bore: Mesh
}

/** How far past each wall its top runs, in metres. */
export const MARGIN = 0.9
/** How deep the headwall's top runs back over the bore, in metres. */
export const HEADWALL = 1.5
/** How far a wall's top stands over the ground beside it, in metres. */
const CAP = 0.15
/** How far a wall's face runs down past the floor, so the terrain never shows a gap under it. */
const FOOT = 0.5

/**
 * The triangles of one portal, relative to `origin`, with heights in metres as
 * they are to be drawn (exaggeration applied). `edges` are the carriageway's.
 * The cut's floor is the terrain itself, carved by `carveFootprint`.
 */
export function portalMesh(points: Point[], at: number, edges: [number, number], cut: Cut, origin: Point, colors: PortalColors, out: PortalMesh) {
  const n = points.length
  const scale = 1 / metresPerUnit(points[at][1])
  const h = (m: number) => m * scale
  const wall = outline(points, [edges[0] + KERB, edges[1] + KERB], origin)
  const back = outline(points, [edges[0] + KERB + MARGIN, edges[1] + KERB + MARGIN], origin)
  const at3 = (p: Point, m: number) => [p[0], p[1], h(m)]
  const { floor, walls } = cut
  const d = along(points)
  const shade = (i: number, color: number[]) => {
    const k = 0.05 + 0.45 * Math.exp(-(d[i] - d[at]) / 5)
    return color.map(c => c * k)
  }
  /** A quad given as its left-side corners, mirrored for the right so both face the same way. */
  const sided = (side: 'left' | 'right', corners: number[][], color: number[]) =>
    side === 'left' ? quad(out.walls, corners[0], corners[1], corners[2], corners[3], color) : quad(out.walls, corners[3], corners[2], corners[1], corners[0], color)
  for (let i = cut.open + 1; i <= at; i++) {
    const [a, b] = [i - 1, i]
    for (const side of ['left', 'right'] as const) {
      const top = walls[side === 'left' ? 0 : 1]
      if (top[a] - floor[a] < 0.05 && top[b] - floor[b] < 0.05) continue
      const [t0, t1] = [top[a] + CAP, top[b] + CAP]
      sided(side, [at3(wall[a][side], floor[a] - FOOT), at3(wall[b][side], floor[b] - FOOT), at3(wall[b][side], t1), at3(wall[a][side], t0)], colors.concrete)
      sided(side, [at3(wall[a][side], t0), at3(wall[b][side], t1), at3(back[b][side], t1), at3(back[a][side], t0)], colors.parapet)
      sided(side, [at3(back[a][side], t0), at3(back[b][side], t1), at3(back[b][side], top[b] - 1), at3(back[a][side], top[a] - 1)], colors.parapet)
    }
  }
  // The headwall: its face over the mouth and beside it, and its top.
  const mouth = floor[at] + cut.headroom
  const crown = cut.crown + CAP
  const next = Math.min(n - 1, at + 1)
  const t = Math.min(1, HEADWALL / (d[next] - d[at] || 1))
  const lerp = (p: Point, q: Point): Point => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]
  const [l, r] = [back[at].left, back[at].right]
  const [bl, br] = [lerp(l, back[next].left), lerp(r, back[next].right)]
  quad(out.walls, at3(r, mouth), at3(l, mouth), at3(l, crown), at3(r, crown), colors.concrete)
  for (const side of ['left', 'right'] as const)
    sided(side, [at3(back[at][side], floor[at] - FOOT), at3(wall[at][side], floor[at] - FOOT), at3(wall[at][side], mouth), at3(back[at][side], mouth)], colors.concrete)
  quad(out.walls, at3(l, crown), at3(r, crown), at3(br, crown), at3(bl, crown), colors.parapet)
  // Its back and sides, down into the ground, so it stands solid from behind.
  const base = floor[at] - FOOT
  quad(out.walls, at3(br, base), at3(bl, base), at3(bl, crown), at3(br, crown), colors.concrete)
  quad(out.walls, at3(l, base), at3(bl, base), at3(bl, crown), at3(l, crown), colors.concrete)
  quad(out.walls, at3(br, base), at3(r, base), at3(r, crown), at3(br, crown), colors.concrete)
  quad(out.mouth, at3(wall[at].left, floor[at] - FOOT), at3(wall[at].right, floor[at] - FOOT), at3(wall[at].right, mouth), at3(wall[at].left, mouth), colors.bore)
  // The bore, darkening away from the light, closed off at its far end.
  for (let i = at + 1; i < n; i++) {
    const [a, b] = [i - 1, i]
    const [fa, fb] = [floor[a], floor[b]]
    const [ca, cb] = [fa + cut.headroom, fb + cut.headroom]
    const [la, lb, ra, rb] = [wall[a].left, wall[b].left, wall[a].right, wall[b].right]
    quad(out.bore, at3(la, fa), at3(ra, fa), at3(rb, fb), at3(lb, fb), shade(a, colors.surface))
    quad(out.bore, at3(la, fa), at3(lb, fb), at3(lb, cb), at3(la, ca), shade(a, colors.bore))
    quad(out.bore, at3(ra, ca), at3(rb, cb), at3(rb, fb), at3(ra, fa), shade(a, colors.bore))
    quad(out.bore, at3(la, ca), at3(lb, cb), at3(rb, cb), at3(ra, ca), shade(a, colors.bore))
  }
  const last = n - 1
  if (last > at) quad(out.bore, at3(wall[last].left, floor[last]), at3(wall[last].right, floor[last]), at3(wall[last].right, floor[last] + cut.headroom), at3(wall[last].left, floor[last] + cut.headroom), shade(last, colors.bore))
}

/** A portal's line: the approach from its far end to the portal, then the bore, each sampled every `step` metres. */
export function portalLine(approachOut: Point[], bore: Point[], step: number): { points: Point[]; at: number } {
  const outside = densify([...approachOut].reverse(), step)
  return { points: [...outside, ...densify(bore, step).slice(1)], at: outside.length - 1 }
}
