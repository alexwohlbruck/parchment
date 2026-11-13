/**
 * Road tunnels in 3D: the geometry behind their portals.
 *
 * A tunnel runs under the terrain, where nothing of it shows but its portals.
 * Each portal is drawn as the cut leading down to it — a ramp between retaining
 * walls, the headwall over the opening, and the first stretch of the bore going
 * dark — inside a hole the layer masks out of the terrain (see `tunnel-layer.ts`).
 * Barrelman solves each cut from OSM and the terrain and serves it in the
 * detail tiles; this draws it.
 *
 * Pure functions, in Web Mercator units for position and metres for height.
 */
import { along, mercator, metresPerUnit, outline, parseLine, parseProfile, quad, type Mesh, type Point } from '@/lib/map-decks/decks'

export type BoreKind = 'road' | 'path' | 'rail'
const KINDS: BoreKind[] = ['road', 'path', 'rail']

/** The kerb between a carriageway and the wall beside it, in metres. */
export const KERB = 0.6

const heading = (a: Point, b: Point): Point => {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
  return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]
}

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
  /** The lowest ground at either side of the portal, which the headwall stands down to. */
  base: number
}

/**
 * A portal's cut as served: its line from just before the cut opens, through the portal (`at`), into the bore.
 * `cover` is the ground over the bore from the portal in, one value a vertex; `under` an underpass, whose
 * headwall is the edge of the street or building over it; `shared` the cut leading the portals beside it, which share one headwall.
 */
export type ServedCut = {
  key: string; points: Point[]; at: number; edges: [number, number]; cut: Cut; kind: BoreKind; face?: Point; piers?: Array<[number, number]>
  cover?: number[]; under: boolean; shared?: string
}

/** A cut from a `tunnel_cuts` tile feature's properties, or null for one that does not hold together. */
export function parseCut(props: Record<string, any>): ServedCut | null {
  const points = parseLine(props.line).map(mercator)
  const floor = parseProfile(props.floor)
  const walls: [number[], number[]] = [parseProfile(props.wall_left), parseProfile(props.wall_right)]
  const [at, open] = [Number(props.at), Number(props.open)]
  const kind = props.kind as BoreKind
  if (!KINDS.includes(kind) || !(open >= 0 && open < at && at < points.length - 1)) return null
  if ([floor, ...walls].some(values => values.length !== points.length)) return null
  const spans = parseProfile(props.piers)
  const piers = spans.length ? Array.from({ length: spans.length / 2 }, (_, i) => [spans[i * 2], spans[i * 2 + 1]] as [number, number]) : undefined
  const face = typeof props.face === 'string' && props.face ? (props.face.split(',').map(Number) as Point) : undefined
  const cover = parseProfile(props.cover)
  return {
    key: String(props.id), points, at, kind, face, piers,
    cover: cover.length === points.length - at ? cover : undefined,
    under: props.under === true,
    shared: typeof props.shared === 'string' && props.shared ? props.shared : undefined,
    edges: [Number(props.left_edge), Number(props.right_edge)],
    cut: { floor, walls, open, crown: Number(props.crown), headroom: Number(props.headroom), base: Number(props.base) },
  }
}

/** A headwall to be joined to its neighbours': its outer corners, heading, top and foot, heights as drawn. */
export type Headwall = { corners: [Point, Point]; heading: Point; scale: number; top: number; foot: number }

/**
 * One wall between neighbouring portals' headwalls, from each one's nearer corner to the other's: portals side
 * by side stand in one headwall, as the Lincoln Tunnel's three bores do, rather than as boxes with ground between.
 * Returns each wall, relative to the origin, with the way its back faces and its top in metres, for the ground behind it to be filled.
 */
export function joinHeadwalls(walls: Headwall[], colors: PortalColors, out: PortalMesh): Array<{ from: Point; to: Point; behind: Point; top: number }> {
  const joins: Array<{ from: Point; to: Point; behind: Point; top: number }> = []
  const lead = walls[0]
  const left = (p: Point) => (p[0] * -lead.heading[1] + p[1] * lead.heading[0])
  const sorted = [...walls].sort((a, b) => left(a.corners[0]) + left(a.corners[1]) - left(b.corners[0]) - left(b.corners[1]))
  for (let i = 1; i < sorted.length; i++) {
    const [a, b] = [sorted[i - 1], sorted[i]]
    // The facing corners: a's left and b's right, as sorted from right to left.
    const [p, q] = [a.corners[0], b.corners[1]]
    const [hx, hy] = [(a.heading[0] + b.heading[0]) / 2, (a.heading[1] + b.heading[1]) / 2]
    const depth = HEADWALL * a.scale
    const [pb, qb]: Point[] = [[p[0] + hx * depth, p[1] + hy * depth], [q[0] + hx * depth, q[1] + hy * depth]]
    const [top, foot] = [Math.max(a.top, b.top), Math.min(a.foot, b.foot)]
    const at3 = (r: Point, m: number) => [r[0], r[1], m * a.scale]
    quad(out.walls, at3(p, foot), at3(q, foot), at3(q, top), at3(p, top), colors.concrete)
    quad(out.walls, at3(qb, foot), at3(pb, foot), at3(pb, top), at3(qb, top), colors.concrete)
    quad(out.walls, at3(p, top), at3(q, top), at3(qb, top), at3(pb, top), colors.parapet)
    joins.push({ from: p, to: q, behind: [hx, hy], top: Math.min(a.top, b.top) })
  }
  return joins
}

export type PortalColors = { surface: number[]; concrete: number[]; parapet: number[]; bore: number[] }

export type PortalMesh = {
  /** The retaining walls and the headwall, standing in the cut carved into the terrain. */
  walls: Mesh
  /** The opening in the headwall, through which the bore is drawn. */
  mouth: Mesh
  /** Over each cut at its walls' tops, and the floor beneath: the walls are drawn again inside the lid, over the floor, so the terrain cannot cover their feet. */
  lid: Mesh
  floor: Mesh
  /** The bore going dark, drawn only through its mouth. */
  bore: Mesh
}

/** The furthest, in metres, a skewed headwall's corner may stand along the bore from where a square one would. */
const SKEW_LIMIT = 1.5
/** How far past each wall its top runs, in metres. */
export const MARGIN = 0.9
/** How deep the headwall's top runs back over the bore, in metres. */
export const HEADWALL = 3
/** How far a wall's top stands over the ground beside it, in metres. */
const CAP = 0.15
/** How far a wall's face runs down past the floor, so the terrain never shows a gap under it. */
const FOOT = 0.5

/**
 * The triangles of one portal, relative to `origin`, with heights in metres as
 * they are to be drawn (exaggeration applied). `edges` are the carriageway's.
 * The cut's floor is the terrain, carved by `carveTile`; `out.floor` covers it where the terrain is too coarse to.
 */
/**
 * Where a portal's headwall stands, relative to `origin`: the heading the bore runs in along, the point on its face
 * `metres` left of the centreline, and its outer corners. It runs along a wall mapped across the bore, else square to it.
 */
export function headwallFrame(points: Point[], at: number, edges: [number, number], origin: Point, face?: Point) {
  const n = points.length
  const scale = 1 / metresPerUnit(points[at][1])
  const [tx, ty] = heading(points[Math.min(at, n - 2)], points[Math.min(at + 1, n - 1)])
  const across = face ? Math.abs(face[1] * tx - face[0] * ty) : 1
  // Askew by more than the samples either side can follow, the walls beside it would cross; it stands square instead.
  const askew = face && (Math.max(...edges) + KERB + MARGIN) * Math.sqrt(1 - across * across) / across <= SKEW_LIMIT
  const lean = askew && face ? Math.sign(face[1] * tx - face[0] * ty) : 1
  const [wx, wy] = askew && face ? [face[0] * lean, face[1] * lean] : [-ty, tx]
  const skew = wy * tx - wx * ty
  const onFace = (metres: number): Point => [points[at][0] + (wx * metres * scale) / skew - origin[0], points[at][1] + (wy * metres * scale) / skew - origin[1]]
  return { heading: [tx, ty] as Point, scale, onFace, corners: [onFace(edges[0] + KERB + MARGIN), onFace(-(edges[1] + KERB + MARGIN))] as [Point, Point] }
}

/** How far into a bore it is drawn, in metres: past it nothing shows from outside, and a bore curving close in would fold its walls across each other. */
export const BORE_DRAWN = 15

/** `through` draws the whole bore, for an underpass seen through from end to end. */
export function portalMesh(points: Point[], at: number, edges: [number, number], cut: Cut, origin: Point, colors: PortalColors, out: PortalMesh, face?: Point, piers: Array<[number, number]> = [], through = false) {
  const n = through ? points.length : Math.min(points.length, at + 1 + along(points.slice(at)).filter(m => m > 0 && m <= BORE_DRAWN).length)
  const { heading: [tx, ty], scale, onFace } = headwallFrame(points, at, edges, origin, face)
  const h = (m: number) => m * scale
  const wall = outline(points, [edges[0] + KERB, edges[1] + KERB], origin)
  const back = outline(points, [edges[0] + KERB + MARGIN, edges[1] + KERB + MARGIN], origin)
  const square = (left: number, right: number) => ({ left: onFace(left), right: onFace(-right) })
  wall[at] = square(edges[0] + KERB, edges[1] + KERB)
  back[at] = square(edges[0] + KERB + MARGIN, edges[1] + KERB + MARGIN)
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
  // The opening the lid marks stops at the headwall's top at the face: a wall standing higher beside the portal holds back ground, not open air over the bore.
  const lidTop = (side: 0 | 1, i: number) => (i === at ? Math.min(walls[side][i], cut.crown) : walls[side][i]) + CAP
  for (let i = cut.open + 1; i <= at; i++) {
    const [a, b] = [i - 1, i]
    quad(out.lid, at3(wall[a].left, lidTop(0, a)), at3(wall[a].right, lidTop(1, a)), at3(wall[b].right, lidTop(1, b)), at3(wall[b].left, lidTop(0, b)), colors.concrete)
    quad(out.floor, at3(wall[a].left, floor[a]), at3(wall[a].right, floor[a]), at3(wall[b].right, floor[b]), at3(wall[b].left, floor[b]), colors.surface)
    for (const side of ['left', 'right'] as const) {
      const top = walls[side === 'left' ? 0 : 1]
      if (top[a] - floor[a] < 0.05 && top[b] - floor[b] < 0.05) continue
      const [t0, t1] = [top[a] + CAP, top[b] + CAP]
      sided(side, [at3(wall[a][side], floor[a] - FOOT), at3(wall[b][side], floor[b] - FOOT), at3(wall[b][side], t1), at3(wall[a][side], t0)], colors.concrete)
      sided(side, [at3(wall[a][side], t0), at3(wall[b][side], t1), at3(back[b][side], t1), at3(back[a][side], t0)], colors.parapet)
      // Its back runs down to the floor too, so a wall the ground beside falls away from stands solid rather than as a slab.
      sided(side, [at3(back[a][side], t0), at3(back[b][side], t1), at3(back[b][side], floor[b] - FOOT), at3(back[a][side], floor[a] - FOOT)], colors.parapet)
    }
  }
  // The headwall: its face over the mouth and beside it, and its top.
  const mouth = floor[at] + cut.headroom
  const [crownL, crownR] = [cut.crown + CAP, cut.crown + CAP]
  const behind = (p: Point): Point => [p[0] + tx * h(HEADWALL), p[1] + ty * h(HEADWALL)]
  const [l, r] = [back[at].left, back[at].right]
  const [bl, br] = [behind(l), behind(r)]
  quad(out.walls, at3(r, mouth), at3(l, mouth), at3(l, crownL), at3(r, crownR), colors.concrete)
  // Down to the lowest ground beside it, so a headwall over a falling bank does not hang in the air.
  const base = Math.min(floor[at], cut.base) - FOOT
  for (const side of ['left', 'right'] as const)
    sided(side, [at3(back[at][side], base), at3(wall[at][side], base), at3(wall[at][side], mouth), at3(back[at][side], mouth)], colors.concrete)
  quad(out.walls, at3(l, crownL), at3(r, crownR), at3(br, crownR), at3(bl, crownL), colors.parapet)
  // Its back and sides, down into the ground, so it stands solid from behind; the bore runs through.
  const [wl, wr] = [behind(wall[at].left), behind(wall[at].right)]
  quad(out.walls, at3(br, mouth), at3(bl, mouth), at3(bl, crownL), at3(br, crownR), colors.concrete)
  quad(out.walls, at3(bl, base), at3(wl, base), at3(wl, mouth), at3(bl, mouth), colors.concrete)
  quad(out.walls, at3(wr, base), at3(br, base), at3(br, mouth), at3(wr, mouth), colors.concrete)
  quad(out.walls, at3(l, base), at3(bl, base), at3(bl, crownL), at3(l, crownL), colors.concrete)
  quad(out.walls, at3(br, base), at3(r, base), at3(r, crownR), at3(br, crownR), colors.concrete)
  // One opening between each pier and the next; each pier's face stands in the headwall.
  const bounds = [-(edges[1] + KERB), ...piers.flat(), edges[0] + KERB]
  for (let k = 0; k < bounds.length; k += 2) {
    const [r, l] = [onFace(bounds[k]), onFace(bounds[k + 1])]
    quad(out.mouth, at3(l, floor[at] - FOOT), at3(r, floor[at] - FOOT), at3(r, mouth), at3(l, mouth), colors.bore)
    if (k) quad(out.walls, at3(onFace(bounds[k - 1]), floor[at] - FOOT), at3(r, floor[at] - FOOT), at3(r, mouth), at3(onFace(bounds[k - 1]), mouth), colors.concrete)
  }
  const pierSides = piers.map(([from, to]) => {
    const sides = outline(points, [to, -from], origin)
    return [sides.map((s, i) => (i === at ? onFace(from) : s.right)), sides.map((s, i) => (i === at ? onFace(to) : s.left))]
  })
  // The bore, darkening away from the light, closed off at its far end.
  for (let i = at + 1; i < n; i++) {
    const [a, b] = [i - 1, i]
    const [fa, fb] = [floor[a], floor[b]]
    // Never lower than the mouth's top: a floor falling away inside would leave a gap over the bore, through which the ground shows.
    const [ca, cb] = [Math.max(fa + cut.headroom, mouth), Math.max(fb + cut.headroom, mouth)]
    const [la, lb, ra, rb] = [wall[a].left, wall[b].left, wall[a].right, wall[b].right]
    quad(out.bore, at3(la, fa), at3(ra, fa), at3(rb, fb), at3(lb, fb), shade(a, colors.surface))
    quad(out.bore, at3(la, fa), at3(lb, fb), at3(lb, cb), at3(la, ca), shade(a, colors.bore))
    quad(out.bore, at3(ra, ca), at3(rb, cb), at3(rb, fb), at3(ra, fa), shade(a, colors.bore))
    quad(out.bore, at3(la, ca), at3(lb, cb), at3(rb, cb), at3(ra, ca), shade(a, colors.bore))
    for (const [r, l] of pierSides) {
      quad(out.bore, at3(r[a], fa), at3(r[b], fb), at3(r[b], cb), at3(r[a], ca), shade(a, colors.bore))
      quad(out.bore, at3(l[a], ca), at3(l[b], cb), at3(l[b], fb), at3(l[a], fa), shade(a, colors.bore))
    }
  }
  const last = n - 1
  if (last > at) quad(out.bore, at3(wall[last].left, floor[last] - FOOT), at3(wall[last].right, floor[last] - FOOT), at3(wall[last].right, Math.max(floor[last] + cut.headroom, mouth)), at3(wall[last].left, Math.max(floor[last] + cut.headroom, mouth)), shade(last, colors.bore))
}
