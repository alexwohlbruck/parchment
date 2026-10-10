/**
 * Lines as vector tiles hand them over: cut at every tile edge, each piece
 * running a little way into its neighbours' buffer and ending wherever the cut
 * fell rather than at a vertex of the line.
 */

/** On the sphere the layer projects onto, so a span ends where its segment does. */
export const METRES_PER_DEGREE = (2 * Math.PI * 6371008.8) / 360

export type Bounds = { minLng: number; maxLng: number; minLat: number; maxLat: number }

export function tileBounds(feature: any): Bounds | null {
  const { _x: x, _y: y, _z: z } = feature
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return null
  const n = 2 ** z
  const lat = (t: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * t) / n))) * 180) / Math.PI
  return { minLng: (x / n) * 360 - 180, maxLng: ((x + 1) / n) * 360 - 180, minLat: lat(y + 1), maxLat: lat(y) }
}

export const inside = (b: Bounds | null, lng: number, lat: number) =>
  !b || (lng >= b.minLng && lng < b.maxLng && lat >= b.minLat && lat < b.maxLat)

/** One feature as it sits in one tile, which is the unit the layer asks for positions by. */
export const pieceKey = (feature: any) => `${feature.id}/${feature._z}/${feature._x}/${feature._y}`

/** Compass bearing and length in metres from a to b, flat-earth over a segment. */
export function measure(a: number[], b: number[]): { bearing: number; length: number } {
  const k = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180)
  const east = (b[0] - a[0]) * k * METRES_PER_DEGREE
  const north = (b[1] - a[1]) * METRES_PER_DEGREE
  return { bearing: ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360, length: Math.hypot(east, north) }
}

/** The bearing halfway between two, the way a tower turns to hold a bend. */
export function between(b1: number, b2: number): number {
  const r = (d: number) => (d * Math.PI) / 180
  return ((Math.atan2(Math.sin(r(b1)) + Math.sin(r(b2)), Math.cos(r(b1)) + Math.cos(r(b2))) * 180) / Math.PI + 360) % 360
}

export function linesOf(geometry: any): number[][][] {
  switch (geometry?.type) {
    case 'LineString': return [geometry.coordinates]
    case 'MultiLineString': return geometry.coordinates
    case 'Polygon': return geometry.coordinates
    case 'MultiPolygon': return geometry.coordinates.flat()
    default: return []
  }
}

/** A real vertex of a line, held by the one tile piece it falls inside. */
export type LineNode = { lng: number; lat: number; piece: string }

export type LineEdge = { from: LineNode; to: LineNode; kind: string }

/** Consecutive vertices inside one tile, and the vertices either side of them that are not. */
type Run = { verts: number[][]; before?: number[]; after?: number[]; piece: string; kind: string }

/** How far off a segment's bearing a cut piece may point and still be taken for the same segment. */
const CUT_ANGLE = (3 * Math.PI) / 180

/**
 * A line's real vertices and segments, rejoined from its tile pieces.
 *
 * A vertex is trusted only inside its own tile: past the edge it may be where
 * the tile cut the line rather than a vertex of it. A segment that leaves a
 * tile is rejoined to the nearest vertex another piece of the same line holds
 * straight ahead of it. Vertices shared between lines become one node, so
 * edges meeting there hold the same object.
 */
export function stitch(features: any[]): LineEdge[] {
  const runs = new Map<string, Run[]>()
  for (const feature of features) {
    if (feature.id === undefined || feature.id === null) continue
    const bounds = tileBounds(feature)
    const piece = pieceKey(feature)
    const kind = feature.properties?.kind
    const group = `${feature.id}/${feature._z}`
    for (const line of linesOf(feature.geometry)) {
      let run: Run | null = null
      line.forEach((p, k) => {
        if (inside(bounds, p[0], p[1])) {
          if (!run) {
            run = { verts: [], before: line[k - 1], piece, kind }
            const list = runs.get(group)
            if (list) list.push(run)
            else runs.set(group, [run])
          }
          run.verts.push(p)
        } else if (run) {
          run.after = p
          run = null
        }
      })
    }
  }

  const nodes = new Map<string, LineNode>()
  const node = (p: number[], piece: string) => {
    const key = `${p[0]},${p[1]}`
    let n = nodes.get(key)
    if (!n) nodes.set(key, (n = { lng: p[0], lat: p[1], piece }))
    return n
  }
  const edges: LineEdge[] = []
  for (const group of runs.values()) {
    for (const run of group) {
      run.verts.slice(1).forEach((b, k) => edges.push({ from: node(run.verts[k], run.piece), to: node(b, run.piece), kind: run.kind }))
      const v = run.verts.at(-1)!
      if (!run.after) continue
      const next = continuation(v, run.after, group)
      if (next) edges.push({ from: node(v, run.piece), to: node(next.verts[0], next.piece), kind: run.kind })
    }
  }
  return edges
}

/** The run that picks a line up again where it left `v` toward `cut`. */
function continuation(v: number[], cut: number[], group: Run[]): Run | null {
  const k = Math.cos((v[1] * Math.PI) / 180) * METRES_PER_DEGREE
  const local = (p: number[]) => [(p[0] - v[0]) * k, (p[1] - v[1]) * METRES_PER_DEGREE]
  const [dx, dy] = local(cut)
  const reach = Math.hypot(dx, dy)
  if (!reach) return null
  const [ux, uy] = [dx / reach, dy / reach]
  let best: Run | null = null
  let nearest = Infinity
  for (const run of group) {
    if (!run.before) continue
    const [wx, wy] = local(run.verts[0])
    const along = wx * ux + wy * uy
    if (along <= 0 || along >= nearest) continue
    if (Math.abs(wx * uy - wy * ux) > Math.max(1, along * Math.sin(CUT_ANGLE))) continue
    const [bx, by] = local(run.before)
    const [ix, iy] = [wx - bx, wy - by]
    const inward = Math.hypot(ix, iy)
    if (!inward || (ix * ux + iy * uy) / inward < Math.cos(CUT_ANGLE)) continue
    best = run
    nearest = along
  }
  return best
}
