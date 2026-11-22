import { STREET_FLAGS } from '@/types/offline-package.types'
import { approxMeters, canTraverse, edgePoints, type StreetGraph, type StreetProfile } from './street-graph'

/** Metres per second. */
export const STREET_SPEED: Record<StreetProfile, number> = { walking: 1.35, cycling: 4.5 }
const MIN_COST_FACTOR = 0.85

export interface PathStep {
  edge: number
  reverse: boolean
}

export interface StreetPath {
  steps: PathStep[]
  /** Metres. */
  distance: number
  /** Seconds. */
  duration: number
}

/** How much less pleasant than its length an edge is to travel. */
function costFactor(flags: number, profile: StreetProfile): number {
  if (profile === 'walking') {
    if (flags & STREET_FLAGS.STEPS) return 1.3
    return flags & STREET_FLAGS.BUSY ? 1.05 : 1
  }
  if (flags & STREET_FLAGS.BIKE_LANE) return MIN_COST_FACTOR
  if (flags & STREET_FLAGS.CAR_FREE) return 0.9
  return flags & STREET_FLAGS.BUSY ? 1.5 : 1
}

class MinHeap {
  private keys: number[] = []
  private values: number[] = []

  get size() {
    return this.keys.length
  }

  push(value: number, key: number) {
    const { keys, values } = this
    let i = keys.length
    keys.push(key)
    values.push(value)
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (keys[parent] <= key) break
      keys[i] = keys[parent]
      values[i] = values[parent]
      i = parent
    }
    keys[i] = key
    values[i] = value
  }

  /** Smallest value; call only when `size > 0`. */
  pop(): number {
    const { keys, values } = this
    const top = values[0]
    const lastKey = keys.pop()!
    const lastValue = values.pop()!
    if (keys.length) {
      let i = 0
      for (;;) {
        let child = i * 2 + 1
        if (child >= keys.length) break
        if (child + 1 < keys.length && keys[child + 1] < keys[child]) child++
        if (keys[child] >= lastKey) break
        keys[i] = keys[child]
        values[i] = values[child]
        i = child
      }
      keys[i] = lastKey
      values[i] = lastValue
    }
    return top
  }
}

interface Search {
  cost: Float64Array
  via: Int32Array
}

function search(
  graph: StreetGraph,
  source: number,
  profile: StreetProfile,
  { target, maxCost }: { target?: number; maxCost?: number },
): Search {
  const nodes = graph.nodeLng.length
  const cost = new Float64Array(nodes).fill(Infinity)
  const via = new Int32Array(nodes).fill(-1)
  const done = new Uint8Array(nodes)
  const speed = STREET_SPEED[profile]
  const heuristic =
    target === undefined
      ? () => 0
      : (n: number) =>
          (approxMeters(graph.nodeLng[n], graph.nodeLat[n], graph.nodeLng[target], graph.nodeLat[target]) *
            MIN_COST_FACTOR) /
          speed
  const heap = new MinHeap()
  cost[source] = 0
  heap.push(source, heuristic(source))
  while (heap.size) {
    const n = heap.pop()
    if (done[n]) continue
    done[n] = 1
    if (n === target) break
    for (let i = graph.adjStart[n]; i < graph.adjStart[n + 1]; i++) {
      const e = graph.adjEdge[i]
      const reverse = graph.adjReverse[i] === 1
      if (!canTraverse(graph, e, reverse, profile)) continue
      const next = reverse ? graph.edgeFrom[e] : graph.edgeTo[e]
      const c = cost[n] + (graph.edgeLength[e] * costFactor(graph.edgeFlags[e], profile)) / speed
      if (c >= cost[next] || (maxCost !== undefined && c > maxCost)) continue
      cost[next] = c
      via[next] = i
      heap.push(next, c + heuristic(next))
    }
  }
  return { cost, via }
}

function pathTo(graph: StreetGraph, { via }: Search, source: number, target: number, profile: StreetProfile): StreetPath {
  const steps: PathStep[] = []
  let n = target
  while (n !== source) {
    const half = via[n]
    const edge = graph.adjEdge[half]
    const reverse = graph.adjReverse[half] === 1
    steps.push({ edge, reverse })
    n = reverse ? graph.edgeTo[edge] : graph.edgeFrom[edge]
  }
  steps.reverse()
  const distance = steps.reduce((sum, s) => sum + graph.edgeLength[s.edge], 0)
  return { steps, distance, duration: distance / STREET_SPEED[profile] }
}

export function shortestPath(
  graph: StreetGraph,
  source: number,
  target: number,
  profile: StreetProfile,
): StreetPath | null {
  if (source === target) return { steps: [], distance: 0, duration: 0 }
  const result = search(graph, source, profile, { target })
  if (result.via[target] < 0) return null
  return pathTo(graph, result, source, target, profile)
}

/** Travel time in seconds from `source` to every node reachable within `maxSeconds`. */
export function travelTimes(
  graph: StreetGraph,
  source: number,
  profile: StreetProfile,
  maxSeconds: number,
): Map<number, number> {
  const { cost } = search(graph, source, profile, { maxCost: maxSeconds })
  const times = new Map<number, number>()
  cost.forEach((c, n) => {
    if (c <= maxSeconds) times.set(n, c)
  })
  return times
}

export function pathPoints(graph: StreetGraph, path: StreetPath): [number, number][] {
  const points: [number, number][] = []
  for (const step of path.steps) {
    const edge = edgePoints(graph, step.edge, step.reverse)
    points.push(...(points.length ? edge.slice(1) : edge))
  }
  return points
}

export type TurnModifier =
  | 'straight' | 'slight-left' | 'slight-right' | 'left' | 'right' | 'sharp-left' | 'sharp-right' | 'u-turn'

export interface StreetManeuver {
  type: 'depart' | 'turn' | 'continue' | 'destination'
  modifier?: TurnModifier
  /** The street travelled after this maneuver, if it has a name. */
  streetName?: string
  steps?: boolean
  lng: number
  lat: number
  /** Metres and seconds until the next maneuver. */
  distance: number
  duration: number
}

function bearing([lng1, lat1]: [number, number], [lng2, lat2]: [number, number]): number {
  const toRad = Math.PI / 180
  const y = Math.sin((lng2 - lng1) * toRad) * Math.cos(lat2 * toRad)
  const x =
    Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) -
    Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos((lng2 - lng1) * toRad)
  return (Math.atan2(y, x) / toRad + 360) % 360
}

export function turnModifier(fromBearing: number, toBearing: number): TurnModifier {
  const turn = ((toBearing - fromBearing + 540) % 360) - 180
  const a = Math.abs(turn)
  const side = turn < 0 ? 'left' : 'right'
  if (a < 20) return 'straight'
  if (a < 60) return `slight-${side}`
  if (a < 135) return side
  if (a < 170) return `sharp-${side}`
  return 'u-turn'
}

/** Shorter stretches between two of the same street are folded into it, as a jog across a junction. */
const JOG_METRES = 20

/** Turn-by-turn maneuvers: one wherever the street name changes. */
export function pathManeuvers(graph: StreetGraph, path: StreetPath, profile: StreetProfile): StreetManeuver[] {
  if (!path.steps.length) return []
  const name = (s: PathStep) => graph.edgeName[s.edge]
  const isSteps = (s: PathStep) => (graph.edgeFlags[s.edge] & STREET_FLAGS.STEPS) !== 0
  const runs: { steps: PathStep[]; name: number; distance: number; stairs: boolean }[] = []
  for (const step of path.steps) {
    const last = runs[runs.length - 1]
    if (last && last.name === name(step) && last.stairs === isSteps(step)) {
      last.steps.push(step)
      last.distance += graph.edgeLength[step.edge]
    } else {
      runs.push({ steps: [step], name: name(step), distance: graph.edgeLength[step.edge], stairs: isSteps(step) })
    }
  }
  for (let i = 1; i < runs.length - 1; i++) {
    const [prev, run, next] = [runs[i - 1], runs[i], runs[i + 1]]
    if (run.distance < JOG_METRES && prev.name === next.name && prev.name >= 0 && !run.stairs) {
      prev.steps.push(...run.steps, ...next.steps)
      prev.distance += run.distance + next.distance
      runs.splice(i, 2)
      i--
    }
  }
  // A few metres of crossing or corner before the next street is part of that street's turn.
  for (let i = 0; i < runs.length - 1; i++) {
    if (runs[i].distance >= JOG_METRES || runs[i].stairs) continue
    runs[i + 1].steps.unshift(...runs[i].steps)
    runs[i + 1].distance += runs[i].distance
    runs.splice(i, 1)
    i--
  }

  const speed = STREET_SPEED[profile]
  const maneuvers: StreetManeuver[] = []
  let previousEnd: [number, number][] | null = null
  for (const run of runs) {
    const points = pathPoints(graph, { steps: run.steps, distance: 0, duration: 0 })
    const [lng, lat] = points[0]
    const modifier = previousEnd
      ? turnModifier(bearing(previousEnd[0], previousEnd[1]), bearing(points[0], points[1]))
      : undefined
    maneuvers.push({
      type: previousEnd ? (modifier === 'straight' ? 'continue' : 'turn') : 'depart',
      modifier,
      streetName: run.name >= 0 ? graph.names[run.name] : undefined,
      steps: run.stairs || undefined,
      lng,
      lat,
      distance: run.distance,
      duration: run.distance / speed,
    })
    previousEnd = points.slice(-2)
  }
  const end = pathPoints(graph, path).at(-1)!
  maneuvers.push({ type: 'destination', lng: end[0], lat: end[1], distance: 0, duration: 0 })
  return maneuvers
}
