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
import { MAX_GRADE, along, densify, metresPerUnit, outline, quad, triangle, type Mesh, type Point } from '@/lib/map-decks/decks'

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
export const RIM = [2, 4, 6]
/** Where the ground over a bore is read, in metres in from its portal. */
export const COVER_AT = [10, 15, 20]
/** Metres of bore drawn in from a portal, past where any light reaches. */
export const BORE = 40
/** Farthest any cut runs out from its portal, in metres. */
export const CUT_MAX = Math.max(...Object.values(PROFILES).map(p => p.reach))
/** How much steeper than its grade a cut may climb to meet a junction. */
export const STEEPEST = 2
/** How far the hole's lid stands over the ground, in metres, so the terrain does not cover it. */
export const LID = 0.3
/** The most a headwall rises over a portal's roof, in metres; above it the hillside carries on. */
export const FACADE = 4
/** The shortest forecourt a portal is given, in metres, so a mouth in a hillside has walls to stand in. */
export const FORECOURT = 9
/** The least the ground must stand over a portal, beside it or above the bore, for a cut to be dug, in metres. */
export const RELIEF = 2
/** How far the roof stands over the ground it was read from, in metres: just clear, so the ground hides its slab but not its face. */
export const RISE = 0.2
/** How far the earth over a portal's roof slopes away beside and behind it, and how far down, in metres. */
export const SKIRT = [5, 3]
/** How far back over the bore its roof is built, in metres, until the ground covers it. */
export const ROOF_SPAN = [4, 15]
/** Metres a wall's top is averaged over, so the ground's noise does not show in it. */
const RIM_SPAN = 9
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
  /** The vertex in the bore the roof over it runs back to. */
  roof: number
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
 * until it meets the ground, and more steeply only where the road reaches a
 * `junction` first. The cut opens where the floor has met the ground and is
 * nearly level with the higher rim, and no nearer than a forecourt's length.
 * The roof runs back over the bore until the ground stands as high as the crown.
 */
export function solveCut(d: number[], at: number, ground: number[], beside: [number[], number[]], cover: number, junction = true, profile = PROFILES.road): Cut | null {
  const { headroom, grade } = profile
  const rims = beside.map(rim => rim.map((_, i) => {
    const near = rim.filter((__, k) => Math.abs(d[k] - d[i]) <= RIM_SPAN / 2)
    return near.reduce((a, b) => a + b, 0) / near.length
  }))
  // Read off the ground just out from the portal too: the sample at it can land on the slope into the bore.
  const mouth = Math.min(...ground.filter((_, i) => i <= at && d[at] - d[i] <= RIM_SPAN))
  if (Math.max(cover, rims[0][at], rims[1][at]) - mouth < Math.min(RELIEF, (headroom + ROOF) / 2)) return null
  const portal = Math.min(ground[at], cover - headroom - ROOF)
  const out = (i: number) => d[at] - d[i]
  const floorAt = (grade: number) => ground.map((g, i) => (i > at ? portal : Math.min(g, portal + grade * out(i))))
  // Still in the cut while the floor is below the road's ground or either wall is high.
  const deep = (floor: number[], i: number) => floor[i] < ground[i] - 0.05 || Math.max(rims[0][i], rims[1][i]) - floor[i] >= OPEN
  let floor = floorAt(grade)
  if (junction && at > 0 && deep(floor, 0)) floor = floorAt(Math.min(grade * STEEPEST, Math.max(grade, (ground[0] - portal) / (out(0) || 1))))
  let open = at
  while (open > 0 && deep(floor, open)) open--
  const crown = Math.min(Math.max(cover, rims[0][at], rims[1][at], portal + headroom + ROOF), portal + headroom + ROOF + FACADE)
  if (crown - portal >= headroom + ROOF) while (open > 0 && d[at] - d[open] < FORECOURT) open--
  const walls = rims.map(rim => floor.map((f, i) => (i > at ? f + headroom + ROOF : i <= open ? f : Math.max(rim[i], f)))) as [number[], number[]]
  let roof = at
  while (roof < d.length - 1 && d[roof] - d[at] < ROOF_SPAN[1] && (d[roof] - d[at] < ROOF_SPAN[0] || ground[roof] < crown)) roof++
  return { floor, walls, open, crown, roof, headroom }
}

/** `ground` is what the map draws around the portal, for the earth over the bore to take on. */
export type PortalColors = { surface: number[]; concrete: number[]; parapet: number[]; bore: number[]; ground: number[] }

export type PortalMesh = {
  /** Drawn only within the hole: the cut, the headwall and the bore. */
  inside: Mesh
  /** The hole's lid, level with the wall tops. */
  lid: Mesh
  /** Drawn over the terrain: the headwall again, where it stands above the ground, and the copings. */
  outside: Mesh
  /** The earth over each bore, drawn over the terrain but never over a cut. */
  earth: Mesh
}

/** Coping width and how far it stands over a wall, in metres. */
const COPING = [0.35, 0.6]

/**
 * The triangles of one portal, relative to `origin`, with heights in metres as
 * they are to be drawn (exaggeration applied). `edges` are the carriageway's.
 */
export function portalMesh(points: Point[], at: number, edges: [number, number], cut: Cut, origin: Point, colors: PortalColors, out: PortalMesh) {
  const n = points.length
  const scale = 1 / metresPerUnit(points[at][1])
  const h = (m: number) => m * scale
  const road = outline(points, edges, origin)
  const wall = outline(points, [edges[0] + KERB, edges[1] + KERB], origin)
  const coping = outline(points, [edges[0] + KERB + COPING[0], edges[1] + KERB + COPING[0]], origin)
  const at3 = (p: Point, m: number) => [p[0], p[1], h(m)]
  const { floor, walls } = cut
  const d = along(points)
  const shade = (i: number, color: number[]) => {
    const k = 0.05 + 0.45 * Math.exp(-(d[i] - d[at]) / 5)
    return color.map(c => c * k)
  }
  for (let i = cut.open + 1; i <= at; i++) {
    const [a, b] = [i - 1, i]
    quad(out.inside, at3(road[a].left, floor[a]), at3(road[a].right, floor[a]), at3(road[b].right, floor[b]), at3(road[b].left, floor[b]), colors.surface)
    for (const side of ['left', 'right'] as const) {
      const k = side === 'left' ? 0 : 1
      const top = walls[k]
      // Kerb, and the wall's face toward the road.
      const kerb = [at3(wall[a][side], floor[a]), at3(road[a][side], floor[a]), at3(road[b][side], floor[b]), at3(wall[b][side], floor[b])]
      const face = [at3(wall[a][side], floor[a]), at3(wall[b][side], floor[b]), at3(wall[b][side], top[b] + LID), at3(wall[a][side], top[a] + LID)]
      if (side === 'left') {
        quad(out.inside, kerb[0], kerb[1], kerb[2], kerb[3], colors.concrete)
        quad(out.inside, face[0], face[1], face[2], face[3], colors.concrete)
      } else {
        quad(out.inside, kerb[3], kerb[2], kerb[1], kerb[0], colors.concrete)
        quad(out.inside, face[3], face[2], face[1], face[0], colors.concrete)
      }
      // A coping along the top, low where the wall is.
      const rise = [a, b].map(j => Math.min(COPING[1], (top[j] - floor[j]) / 2))
      if (rise[0] <= 0.05 && rise[1] <= 0.05) continue
      const [w0, w1, c0, c1] = [wall[a][side], wall[b][side], coping[a][side], coping[b][side]]
      const [t0, t1] = [top[a] + LID + rise[0], top[b] + LID + rise[1]]
      const box = [
        [at3(w0, top[a]), at3(w1, top[b]), at3(w1, t1), at3(w0, t0)],
        [at3(w0, t0), at3(w1, t1), at3(c1, t1), at3(c0, t0)],
        [at3(c0, t0), at3(c1, t1), at3(c1, top[b]), at3(c0, top[a])],
      ]
      for (const f of box) side === 'left' ? quad(out.outside, f[0], f[1], f[2], f[3], colors.parapet) : quad(out.outside, f[3], f[2], f[1], f[0], colors.parapet)
    }
    quad(out.lid, at3(wall[a].left, walls[0][a] + LID), at3(wall[a].right, walls[1][a] + LID), at3(wall[b].right, walls[1][b] + LID), at3(wall[b].left, walls[0][b] + LID), colors.concrete)
  }
  // The headwall, and behind it the earth over the bore: a roof just over the
  // ground, sloping away on every side so it settles into the terrain.
  const mouth = floor[at] + cut.headroom
  const top = cut.crown + RISE
  const low = top - SKIRT[1]
  const skirt = outline(points, [edges[0] + KERB + COPING[0] + SKIRT[0], edges[1] + KERB + COPING[0] + SKIRT[0]], origin)
  const front = [at3(coping[at].right, mouth), at3(coping[at].left, mouth), at3(coping[at].left, top), at3(coping[at].right, top)]
  for (const mesh of [out.inside, out.outside]) quad(mesh, front[0], front[1], front[2], front[3], colors.concrete)
  const earth = (...corners: number[][]) => {
    const [a, b, c] = corners
    const up = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    const faced = up > 0 ? corners : [...corners].reverse()
    if (faced.length === 3) triangle(out.earth, faced[0], faced[1], faced[2], colors.ground)
    else quad(out.earth, faced[0], faced[1], faced[2], faced[3], colors.ground)
  }
  for (let i = at + 1; i <= cut.roof; i++) {
    const [a, b, sa, sb] = [coping[i - 1], coping[i], skirt[i - 1], skirt[i]]
    earth(at3(a.left, top), at3(a.right, top), at3(b.right, top), at3(b.left, top))
    earth(at3(sa.left, low), at3(a.left, top), at3(b.left, top), at3(sb.left, low))
    earth(at3(a.right, top), at3(sa.right, low), at3(sb.right, low), at3(b.right, top))
  }
  let back = cut.roof
  while (back < n - 1 && d[back] - d[cut.roof] < SKIRT[0]) back++
  const [end, behind, edge] = [coping[cut.roof], coping[back], skirt[cut.roof]]
  earth(at3(end.left, top), at3(end.right, top), at3(behind.right, low), at3(behind.left, low))
  earth(at3(edge.left, low), at3(end.left, top), at3(behind.left, low))
  earth(at3(end.right, top), at3(edge.right, low), at3(behind.right, low))
  earth(at3(skirt[at].left, low), at3(coping[at].left, top), at3(coping[at].left, low))
  earth(at3(coping[at].right, top), at3(skirt[at].right, low), at3(coping[at].right, low))
  // The bore, darkening away from the light, closed off at its far end.
  for (let i = at + 1; i < n; i++) {
    const [a, b] = [i - 1, i]
    const [fa, fb] = [floor[a], floor[b]]
    const [ca, cb] = [fa + cut.headroom, fb + cut.headroom]
    const [la, lb, ra, rb] = [wall[a].left, wall[b].left, wall[a].right, wall[b].right]
    quad(out.inside, at3(la, fa), at3(ra, fa), at3(rb, fb), at3(lb, fb), shade(a, colors.surface))
    quad(out.inside, at3(la, fa), at3(lb, fb), at3(lb, cb), at3(la, ca), shade(a, colors.bore))
    quad(out.inside, at3(ra, ca), at3(rb, cb), at3(rb, fb), at3(ra, fa), shade(a, colors.bore))
    quad(out.inside, at3(la, ca), at3(lb, cb), at3(rb, cb), at3(ra, ca), shade(a, colors.bore))
  }
  const last = n - 1
  if (last > at) quad(out.inside, at3(wall[last].left, floor[last]), at3(wall[last].right, floor[last]), at3(wall[last].right, floor[last] + cut.headroom), at3(wall[last].left, floor[last] + cut.headroom), shade(last, colors.bore))
}

/** A portal's line: the approach from its far end to the portal, then the bore, each sampled every `step` metres. */
export function portalLine(approachOut: Point[], bore: Point[], step: number): { points: Point[]; at: number } {
  const outside = densify([...approachOut].reverse(), step)
  return { points: [...outside, ...densify(bore, step).slice(1)], at: outside.length - 1 }
}
