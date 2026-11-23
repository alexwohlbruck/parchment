import { STREET_EDGE_STRIDE, STREET_FLAGS, type StreetsPackage } from '@/types/offline-package.types'

const SCALE = 1e6
const CELL_DEG = 0.002

export type StreetProfile = 'walking' | 'cycling'

/** A decoded street graph with both directions of every edge in one adjacency list. */
export interface StreetGraph {
  nodeLng: Float64Array
  nodeLat: Float64Array
  edgeFrom: Uint32Array
  edgeTo: Uint32Array
  /** Metres. */
  edgeLength: Float32Array
  edgeFlags: Uint16Array
  edgeName: Int32Array
  shapeStart: Uint32Array
  shapeCount: Uint32Array
  shapeLng: Float64Array
  shapeLat: Float64Array
  names: string[]
  /** For node `n`, half-edges `adjStart[n] .. adjStart[n+1]` in `adjEdge`; `adjReverse` marks ones walked `to → from`. */
  adjStart: Uint32Array
  adjEdge: Uint32Array
  adjReverse: Uint8Array
  cells: Map<string, number[]>
  bounds: StreetsPackage['bounds']
}

const cellKey = (lng: number, lat: number) => `${Math.floor(lng / CELL_DEG)}:${Math.floor(lat / CELL_DEG)}`

export function decodeStreetGraph(pkg: StreetsPackage): StreetGraph {
  const nodeCount = pkg.nodes.length / 2
  const nodeLng = new Float64Array(nodeCount)
  const nodeLat = new Float64Array(nodeCount)
  let lng = 0
  let lat = 0
  for (let i = 0; i < nodeCount; i++) {
    lng += pkg.nodes[i * 2]
    lat += pkg.nodes[i * 2 + 1]
    nodeLng[i] = lng / SCALE
    nodeLat[i] = lat / SCALE
  }

  const edgeCount = pkg.edges.length / STREET_EDGE_STRIDE
  const edgeFrom = new Uint32Array(edgeCount)
  const edgeTo = new Uint32Array(edgeCount)
  const edgeLength = new Float32Array(edgeCount)
  const edgeFlags = new Uint16Array(edgeCount)
  const edgeName = new Int32Array(edgeCount)
  const shapeStart = new Uint32Array(edgeCount)
  const shapeCount = new Uint32Array(edgeCount)
  const shapeLng = new Float64Array(pkg.shapes.length / 2)
  const shapeLat = new Float64Array(pkg.shapes.length / 2)
  const degree = new Uint32Array(nodeCount + 1)

  let shape = 0
  for (let e = 0; e < edgeCount; e++) {
    const o = e * STREET_EDGE_STRIDE
    edgeFrom[e] = pkg.edges[o]
    edgeTo[e] = pkg.edges[o + 1]
    edgeLength[e] = pkg.edges[o + 2] / 10
    edgeFlags[e] = pkg.edges[o + 3]
    edgeName[e] = pkg.edges[o + 4]
    const count = pkg.edges[o + 5]
    shapeStart[e] = shape
    shapeCount[e] = count
    let x = nodeLng[edgeFrom[e]] * SCALE
    let y = nodeLat[edgeFrom[e]] * SCALE
    for (let k = 0; k < count; k++, shape++) {
      x += pkg.shapes[shape * 2]
      y += pkg.shapes[shape * 2 + 1]
      shapeLng[shape] = x / SCALE
      shapeLat[shape] = y / SCALE
    }
    degree[edgeFrom[e]]++
    degree[edgeTo[e]]++
  }

  const adjStart = new Uint32Array(nodeCount + 1)
  for (let n = 0; n < nodeCount; n++) adjStart[n + 1] = adjStart[n] + degree[n]
  const fill = adjStart.slice(0, nodeCount)
  const adjEdge = new Uint32Array(edgeCount * 2)
  const adjReverse = new Uint8Array(edgeCount * 2)
  for (let e = 0; e < edgeCount; e++) {
    adjEdge[fill[edgeFrom[e]]++] = e
    const back = fill[edgeTo[e]]++
    adjEdge[back] = e
    adjReverse[back] = 1
  }

  const cells = new Map<string, number[]>()
  for (let n = 0; n < nodeCount; n++) {
    const key = cellKey(nodeLng[n], nodeLat[n])
    const list = cells.get(key)
    if (list) list.push(n)
    else cells.set(key, [n])
  }

  return {
    nodeLng, nodeLat, edgeFrom, edgeTo, edgeLength, edgeFlags, edgeName,
    shapeStart, shapeCount, shapeLng, shapeLat, names: pkg.names,
    adjStart, adjEdge, adjReverse, cells, bounds: pkg.bounds,
  }
}

/** Whether a cyclist riding edge `e` in this direction goes against a one-way street. */
export function againstOneWay(graph: StreetGraph, e: number, reverse: boolean): boolean {
  return (graph.edgeFlags[e] & (reverse ? STREET_FLAGS.BIKE_FORWARD_ONLY : STREET_FLAGS.BIKE_BACKWARD_ONLY)) !== 0
}

/** Whether `profile` may travel edge `e` in the given direction; `walkBike` lets a cyclist push against one-way streets. */
export function canTraverse(graph: StreetGraph, e: number, reverse: boolean, profile: StreetProfile, walkBike = false): boolean {
  const flags = graph.edgeFlags[e]
  if (profile === 'walking') return (flags & STREET_FLAGS.FOOT) !== 0
  if (!(flags & STREET_FLAGS.BIKE)) return false
  return walkBike || !againstOneWay(graph, e, reverse)
}

const mainNetworks = new WeakMap<StreetGraph, Partial<Record<StreetProfile, Uint8Array>>>()

/**
 * Nodes on the largest network `profile` can travel, ignoring one-way rules.
 * Paths cut off at the area's edge leave stray pieces; snapping onto one
 * strands the route.
 */
function mainNetwork(graph: StreetGraph, profile: StreetProfile): Uint8Array {
  const cached = mainNetworks.get(graph)?.[profile]
  if (cached) return cached
  const nodes = graph.nodeLng.length
  const component = new Int32Array(nodes).fill(-1)
  const sizes: number[] = []
  const stack: number[] = []
  const walkable = (i: number) => {
    const e = graph.adjEdge[i]
    return canTraverse(graph, e, false, profile) || canTraverse(graph, e, true, profile)
  }
  for (let start = 0; start < nodes; start++) {
    if (component[start] >= 0) continue
    const id = sizes.length
    let size = 0
    component[start] = id
    stack.push(start)
    while (stack.length) {
      const n = stack.pop()!
      size++
      for (let i = graph.adjStart[n]; i < graph.adjStart[n + 1]; i++) {
        if (!walkable(i)) continue
        const e = graph.adjEdge[i]
        const next = graph.adjReverse[i] ? graph.edgeFrom[e] : graph.edgeTo[e]
        if (component[next] < 0) {
          component[next] = id
          stack.push(next)
        }
      }
    }
    sizes.push(size)
  }
  const largest = sizes.indexOf(Math.max(...sizes))
  const main = Uint8Array.from(component, c => (c === largest ? 1 : 0))
  mainNetworks.set(graph, { ...mainNetworks.get(graph), [profile]: main })
  return main
}

/** Equirectangular distance in metres, exact enough within a city. */
export function approxMeters(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const x = (lng2 - lng1) * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180))
  const y = lat2 - lat1
  return Math.sqrt(x * x + y * y) * 111_195
}

export function containsPoint(graph: StreetGraph, lng: number, lat: number): boolean {
  const [w, s, e, n] = graph.bounds
  return lng >= w && lng <= e && lat >= s && lat <= n
}

/** The nearest node on the main network `profile` travels, within `maxMeters`. */
export function nearestNode(
  graph: StreetGraph,
  lng: number,
  lat: number,
  profile: StreetProfile,
  maxMeters = 500,
): number | null {
  const reach = Math.ceil(maxMeters / 111_195 / CELL_DEG / Math.max(0.2, Math.cos((lat * Math.PI) / 180)))
  const cx = Math.floor(lng / CELL_DEG)
  const cy = Math.floor(lat / CELL_DEG)
  const main = mainNetwork(graph, profile)
  let best: number | null = null
  let bestDist = maxMeters
  for (let ring = 0; ring <= reach; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue
        for (const n of graph.cells.get(`${cx + dx}:${cy + dy}`) ?? []) {
          const d = approxMeters(lng, lat, graph.nodeLng[n], graph.nodeLat[n])
          if (d < bestDist && main[n]) {
            best = n
            bestDist = d
          }
        }
      }
    }
    // Anything in the next ring is at least `ring` cells away.
    if (best !== null && bestDist < ring * CELL_DEG * 111_195 * Math.cos((lat * Math.PI) / 180)) break
  }
  return best
}

/** The edge's points from where it is entered to where it is left, as [lng, lat]. */
export function edgePoints(graph: StreetGraph, e: number, reverse: boolean): [number, number][] {
  const points: [number, number][] = [[graph.nodeLng[graph.edgeFrom[e]], graph.nodeLat[graph.edgeFrom[e]]]]
  const start = graph.shapeStart[e]
  for (let k = 0; k < graph.shapeCount[e]; k++) points.push([graph.shapeLng[start + k], graph.shapeLat[start + k]])
  points.push([graph.nodeLng[graph.edgeTo[e]], graph.nodeLat[graph.edgeTo[e]]])
  return reverse ? points.reverse() : points
}
