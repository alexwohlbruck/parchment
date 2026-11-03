// Steps the router doesn't make: into a station and out of it by an entrance,
// and the escalators and elevators inside.

import type { NavStep, StationVisit } from './nav-route'
import { CLIMB_LOOKAHEAD_METERS, verticalAt, viaOf } from './vertical'
import type { WalkLine } from './walk-steps'

/** Step types made here; standard guidance words them by type. */
export const STATION_STEP_TYPES = new Set(['enterStation', 'exitStation', 'escalator', 'elevator', 'stairs'])

/** A step this soon after the point still reaches it. */
const COVER_AFTER_METERS = 1

interface Added {
  s: number
  segmentIndex: number
  type: string
  station?: StationVisit
}

function visits(line: WalkLine): Added[] {
  const added: Added[] = []
  for (const segment of line.segments) {
    if (segment.mode !== 'walking') continue
    const entrances = line.edges.filter(e => e.segmentIndex === segment.index && e.entrance)
    const exit = line.segments[segment.index - 1]?.mode === 'transit' ? entrances[0] : undefined
    const enter = line.segments[segment.index + 1]?.mode === 'transit' ? entrances.at(-1) : undefined
    if (exit) added.push({ s: exit.startDistance, segmentIndex: segment.index, type: 'exitStation', station: { ...exit.entrance, exit: true } })
    if (enter && enter !== exit) added.push({ s: enter.startDistance, segmentIndex: segment.index, type: 'enterStation', station: { ...enter.entrance, exit: false } })
  }
  return added
}

/** Escalators, elevators and indoor stairs, which a walker goes straight onto without a turn. */
function climbs(line: WalkLine): Added[] {
  const added: Added[] = []
  line.edges.forEach((edge, i) => {
    const via = viaOf(edge)
    const previous = line.edges[i - 1]
    if (!via || line.segments[edge.segmentIndex]?.mode !== 'walking') return
    if (previous && viaOf(previous) === via && edge.startDistance - previous.endDistance <= 1) return
    const run = verticalAt(line, edge.startDistance - 1, edge.startDistance)
    if (run && (via !== 'stairs' || run.indoor)) added.push({ s: edge.startDistance, segmentIndex: edge.segmentIndex, type: via })
  })
  return added
}

export function stationSteps(steps: NavStep[], line: WalkLine): NavStep[] {
  const out = [...steps]
  for (const add of [...visits(line), ...climbs(line)]) {
    const covering = out.findIndex(step => step.segmentIndex === add.segmentIndex
      && step.startDistance >= add.s - CLIMB_LOOKAHEAD_METERS && step.startDistance <= add.s + COVER_AFTER_METERS)
    if (covering >= 0) {
      if (add.station) out[covering] = { ...out[covering], station: add.station }
      continue
    }
    out.push({
      index: -1,
      segmentIndex: add.segmentIndex,
      startDistance: add.s,
      instruction: { type: add.type, text: '', coordinate: line.at(add.s), distance: 0, duration: 0 },
      ...(add.station && { station: add.station }),
    })
  }
  return out
    .sort((a, b) => a.startDistance - b.startDistance || a.segmentIndex - b.segmentIndex)
    .map((step, index) => ({ ...step, index }))
}
