// Where a rider has to get off and push, and for how far, from the edges the
// router marks get-off-bike.

import type { NavEdge, NavRoute } from '../nav-route'
import { MIN_DISMOUNT_METERS } from '../hazards'
import { runAround, verticalAt } from '../vertical'
import type { Dismount, DismountPlace } from './instruction.types'

const CYCLING = new Set(['cycling', 'biking'])
const CROSSWALKS = new Set(['marked', 'unmarked', 'traffic_signals', 'uncontrolled'])

function placeOf(edge: NavEdge): DismountPlace {
  if (edge.roadClass === 'steps') return 'stairs'
  if (edge.roadClass === 'pedestrian') return 'plaza'
  if (edge.roadEnvironment === 'bridge') return 'bridge'
  if (CROSSWALKS.has(edge.crossing?.toLowerCase() ?? '')) return 'crosswalk'
  if (edge.inPark) return 'park'
  return edge.streetName ? 'sidewalk' : 'path'
}

/** The push that starts within [from, to]: up the stairs if it has any, else through whatever most of it is. */
export function dismountAt(route: NavRoute, from: number, to: number): Dismount | null {
  const { edges } = route
  const i = edges.findIndex(e => e.getOffBike && e.startDistance >= from && e.startDistance <= to)
  if (i < 0 || !CYCLING.has(route.segments[edges[i].segmentIndex]?.mode ?? '')) return null
  const [first, last] = runAround(edges, i, e => !!e.getOffBike)
  if (first < i) return null
  const run = edges.slice(first, last + 1)
  const meters = run.at(-1)!.endDistance - run[0].startDistance
  const lengths = new Map<DismountPlace, number>()
  for (const e of run) lengths.set(placeOf(e), (lengths.get(placeOf(e)) ?? 0) + e.endDistance - e.startDistance)
  if (lengths.has('stairs')) {
    const direction = verticalAt(route, run[0].startDistance, run.at(-1)!.endDistance)?.direction
    return { place: 'stairs', meters, ...(direction && { direction }) }
  }
  if (meters < MIN_DISMOUNT_METERS) return null
  const [place] = [...lengths.entries()].reduce((a, b) => (b[1] > a[1] ? b : a))
  return { place, meters }
}
