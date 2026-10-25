// What a route is like, beyond how long it takes: for comparing alternatives.

import type { RouteEdgeSegment, RouteInstruction } from '../types/unified-routing.types'

export interface RouteMetrics {
  duration: number
  distance: number
  /** Real turns: left, right, sharp or U-turns. */
  turns: number
  /** Share of distance on cycle tracks or paths separated from traffic. */
  protectedShare: number
  /** Share of distance on motorway, trunk, primary or secondary roads. */
  majorRoadShare: number
  /** Street crossings along the way. */
  crossings: number
  /** The street carrying most of the route, for "via Elm St". */
  via: string | null
}

const TURNS = new Set(['left', 'right', 'sharp-left', 'sharp-right', 'u-turn'])
const MAJOR = new Set(['motorway', 'trunk', 'primary', 'secondary'])
const SEPARATED_CYCLEWAY = new Set(['track', 'separate'])

const span = (e: RouteEdgeSegment) => Math.max(0, e.endDistance - e.startDistance)

function share(edges: RouteEdgeSegment[], distance: number, test: (e: RouteEdgeSegment) => boolean): number {
  if (distance <= 0) return 0
  return edges.filter(test).reduce((sum, e) => sum + span(e), 0) / distance
}

function mainStreet(instructions: RouteInstruction[]): string | null {
  const byStreet = new Map<string, number>()
  for (const i of instructions) {
    if (i.streetName) byStreet.set(i.streetName, (byStreet.get(i.streetName) ?? 0) + (i.distance ?? 0))
  }
  return [...byStreet.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

export function routeMetrics(leg: {
  duration: number
  distance: number
  instructions?: RouteInstruction[]
  edgeSegments?: RouteEdgeSegment[]
}): RouteMetrics {
  const edges = leg.edgeSegments ?? []
  const instructions = leg.instructions ?? []
  return {
    duration: leg.duration,
    distance: leg.distance,
    turns: instructions.filter(i => (i.modifier && TURNS.has(i.modifier)) || /turn-(sharp-)?(left|right)|u-turn/.test(i.type)).length,
    protectedShare: share(edges, leg.distance, e => e.roadClass === 'cycleway' || SEPARATED_CYCLEWAY.has(e.cycleway ?? '')),
    majorRoadShare: share(edges, leg.distance, e => MAJOR.has(e.roadClass ?? '')),
    crossings: edges.filter(e => e.crossing && e.crossing !== 'MISSING').length,
    via: mainStreet(instructions),
  }
}
