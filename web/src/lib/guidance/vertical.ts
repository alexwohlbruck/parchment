// Which way the route climbs: stairs, escalators and elevators, read from the
// indoor levels either side of them, else from the edges' grades.

import type { NavEdge, NavRoute } from './nav-route'

type Line = Pick<NavRoute, 'edges' | 'segments'>

export type Vertical = 'up' | 'down'
export type VerticalVia = 'stairs' | 'escalator' | 'elevator'

/** Where a climb leaves the walker: a numbered level, or the platform or street of a station. */
export interface FloorChange {
  direction?: Vertical
  level?: string
  to?: 'platform' | 'street'
}

export interface VerticalRun extends FloorChange {
  via: VerticalVia
  start: number
  end: number
  /** The run has indoor levels on either side. */
  indoor: boolean
}

/** Below this the elevation model can't tell up from down. */
const MIN_RISE_METERS = 1
const JOINED_METERS = 1
/** A step or two in a path isn't a flight of stairs. */
const MIN_STAIRS_METERS = 2
/** How far past a step the climb it leads onto is read. */
export const CLIMB_LOOKAHEAD_METERS = 8

export function viaOf(edge: NavEdge): VerticalVia | null {
  if (edge.elevator) return 'elevator'
  if (edge.roadClass !== 'steps') return null
  return edge.conveying ? 'escalator' : 'stairs'
}

/** Metres climbed over [from, to], from the edges' average grades. */
export function rise(edges: NavEdge[], from: number, to: number): number {
  let total = 0
  for (const e of edges) {
    if (e.startDistance >= to) break
    if (e.endDistance <= from) continue
    total += ((e.averageSlope ?? 0) / 100) * (Math.min(e.endDistance, to) - Math.max(e.startDistance, from))
  }
  return total
}

export function climbDirection(edges: NavEdge[], from: number, to: number, min = MIN_RISE_METERS): Vertical | undefined {
  const climbed = rise(edges, from, to)
  if (climbed >= min) return 'up'
  return climbed <= -min ? 'down' : undefined
}

/** An edge's level: absent outdoors, NaN where it spans a range like "-1;0". */
function levelOf(edge: NavEdge | undefined): number | null {
  const level = edge?.level?.trim()
  return level ? Number(level) : null
}

/** Indices of the contiguous edges around `i` that pass `test`. */
export function runAround(edges: NavEdge[], i: number, test: (e: NavEdge) => boolean): [number, number] {
  let first = i
  let last = i
  while (first > 0 && test(edges[first - 1]) && edges[first].startDistance - edges[first - 1].endDistance <= JOINED_METERS) first--
  while (last + 1 < edges.length && test(edges[last + 1]) && edges[last + 1].startDistance - edges[last].endDistance <= JOINED_METERS) last++
  return [first, last]
}

const entranceWithin = (edges: NavEdge[], segmentIndex: number, from: number, to: number) =>
  edges.some(e => e.entrance && e.segmentIndex === segmentIndex && e.startDistance >= from && e.startDistance <= to)

/** Whether any climb lies in (from, to). */
const climbWithin = (edges: NavEdge[], from: number, to: number) =>
  edges.some(e => viaOf(e) && e.startDistance > from && e.startDistance < to)

/** Inside a station, the last climb before boarding reaches the platform, and the last before the exit the street. */
function stationEnd(route: Line, run: { start: number; end: number; segmentIndex: number }): FloorChange['to'] {
  const segment = route.segments[run.segmentIndex]
  if (segment?.mode !== 'walking') return undefined
  const { edges } = route
  const before = route.segments[run.segmentIndex - 1]
  const after = route.segments[run.segmentIndex + 1]
  if (after?.mode === 'transit' && entranceWithin(edges, run.segmentIndex, segment.startDistance, run.start)
    && !climbWithin(edges, run.end, segment.endDistance)) return 'platform'
  if (before?.mode === 'transit') {
    const exit = edges.find(e => e.entrance && e.segmentIndex === run.segmentIndex && e.startDistance >= run.end - JOINED_METERS)
    if (exit && !entranceWithin(edges, run.segmentIndex, segment.startDistance, run.start) && !climbWithin(edges, run.end, exit.startDistance)) return 'street'
  }
  return undefined
}

/** The stairs, escalator or elevator under way within [from, to], and where it leads. */
export function verticalAt(route: Line, from: number, to: number): VerticalRun | null {
  const { edges } = route
  for (let i = 0; i < edges.length && edges[i].startDistance <= to; i++) {
    const via = viaOf(edges[i])
    if (!via || edges[i].endDistance <= from + JOINED_METERS) continue
    const [first, last] = runAround(edges, i, e => viaOf(e) === via)
    if (via === 'stairs' && edges[last].endDistance - edges[first].startDistance < MIN_STAIRS_METERS) {
      i = last
      continue
    }
    return climb(route, via, first, last)
  }
  return null
}

function climb(route: Line, via: VerticalVia, first: number, last: number): VerticalRun {
  const { edges } = route
  const start = edges[first].startDistance
  const end = edges[last].endDistance
  const below = levelOf(edges[first - 1])
  const above = levelOf(edges[last + 1])
  const run: VerticalRun = { via, start, end, indoor: below != null || above != null }
  // The street carries no level: it's the ground floor.
  const fromN = below ?? 0
  const toN = above ?? 0
  if (run.indoor && Number.isFinite(fromN) && Number.isFinite(toN) && fromN !== toN) {
    run.direction = toN > fromN ? 'up' : 'down'
    if (above != null) run.level = edges[last + 1].level!.trim()
  } else {
    const direction = climbDirection(edges, start, end)
    if (direction) run.direction = direction
  }
  const station = stationEnd(route, { start, end, segmentIndex: edges[first].segmentIndex })
  if (station) run.to = station
  return run
}
