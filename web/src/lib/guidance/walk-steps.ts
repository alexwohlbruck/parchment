// On foot, GraphHopper turns at every kink of a sidewalk and crosswalk. Steps
// that close together are one maneuver, read from the heading before and after
// them, with the street crossed on the way as a detail of it.

import type { LngLat } from '@/types/map.types'
import type { RouteInstruction } from '@/types/directions.types'
import { maneuverKind, type ManeuverKind } from '@/lib/directions/maneuver'
import { bearingDeg } from '@/lib/map/movement-interpolation'
import { angleDelta } from './spring'
import type { NavEdge, NavSegment, NavStep, StepCrossing } from './nav-route'
import type { Passage } from './instructions/instruction.types'

export interface WalkLine {
  at: (s: number) => LngLat
  edges: NavEdge[]
  segments: NavSegment[]
}

/** Steps this close after the last one, or after the crossing it starts, belong to it. */
const JOG_METERS = 20
const MAX_SPAN_METERS = 70
const CHORD_METERS = 25
const MIN_CHORD_METERS = 4
const STRAIGHT_DEG = 35
const SLIGHT_DEG = 60
const SHARP_DEG = 140
const UTURN_DEG = 170
/** Just past the maneuver, where stairs or a footbridge would start. */
const PAST_METERS = 8
const MAX_CROSSING_METERS = 45

const PATHS = new Set(['footway', 'path', 'pedestrian', 'cycleway'])
const CROSSINGS = new Set(['marked', 'unmarked', 'traffic_signals', 'uncontrolled'])
const FIXED = new Set<ManeuverKind>(['arrive', 'board', 'roundabout'])
const FORKS = new Set<ManeuverKind>(['keep-left', 'keep-right'])

/** A path tagged as crossing something nameless and unsignalled is most likely passing a driveway. */
const isCrossing = (e: NavEdge) => PATHS.has(e.roadClass ?? '') && CROSSINGS.has(e.crossing?.toLowerCase() ?? '')
  && (!!e.crossingName || e.crossing!.toLowerCase() === 'traffic_signals')

type WalkTurn = Extract<ManeuverKind, 'straight' | 'uturn' | `${'' | 'slight-' | 'sharp-'}${'left' | 'right'}`>

function turnKind(delta: number): WalkTurn {
  const side = delta < 0 ? 'left' : 'right'
  const angle = Math.abs(delta)
  if (angle < STRAIGHT_DEG) return 'straight'
  if (angle >= UTURN_DEG) return 'uturn'
  if (angle < SLIGHT_DEG) return `slight-${side}`
  return angle >= SHARP_DEG ? `sharp-${side}` : side
}

const roadName = (instruction: RouteInstruction) => instruction.streetName || instruction.streetRef || ''

interface Crossed { start: number; end: number; edge: NavEdge; names: Set<string> }

/** The crossings, each joined across islands, that start within `[from, to]`. */
function crossingsWithin(edges: NavEdge[], from: number, to: number): Crossed[] {
  const found: Crossed[] = []
  for (let k = 0; k < edges.length && edges[k].startDistance <= to; k++) {
    if (edges[k].startDistance < from || !isCrossing(edges[k])) continue
    let end = edges[k].endDistance
    let i = k + 1
    for (; i < edges.length && edges[i].startDistance - end <= 1 && isCrossing(edges[i]); i++) end = edges[i].endDistance
    const names = new Set(edges.slice(k, i).flatMap(e => e.crossingName ?? []))
    // A sidewalk carries the tag of a crossing node along it; a crosswalk is short.
    if (end - edges[k].startDistance <= MAX_CROSSING_METERS) found.push({ start: edges[k].startDistance, end, edge: edges[k], names })
    k = i - 1
  }
  return found
}

const crossingFrom = (edges: NavEdge[], from: number, to: number): Crossed | null => crossingsWithin(edges, from, to)[0] ?? null

function heading(line: WalkLine, from: number, to: number): number {
  const a = line.at(from)
  const b = line.at(Math.max(to, from + MIN_CHORD_METERS))
  return bearingDeg(a, b)
}

/** The passage, arcade, building or underpass walked into from `before` onto `past`. */
export function passageInto(before: NavEdge | null | undefined, past: NavEdge | null | undefined): Passage | null {
  if (past?.passage) return past.passage === before?.passage ? null : past.passage
  const tunnel = (e: NavEdge | null | undefined) => e?.roadEnvironment === 'tunnel' && PATHS.has(e.roadClass ?? '')
  return tunnel(past) && !tunnel(before) ? 'underpass' : null
}

/** Stairs, a footbridge, a passage or a park gate just past `s`: a step there says so, even going straight. */
function marksPath(line: WalkLine, s: number): boolean {
  const past = line.edges.find(e => e.startDistance <= s + PAST_METERS && e.endDistance >= s + PAST_METERS)
  const before = line.edges.find(e => e.startDistance <= s - PAST_METERS && e.endDistance >= s - PAST_METERS)
  if (!past) return false
  return past.roadClass === 'steps' || (past.roadEnvironment === 'bridge' && PATHS.has(past.roadClass ?? '')) || (!!past.inPark && !before?.inPark)
    || !!passageInto(before, past)
}

/**
 * Walking steps merged into the maneuvers a walker makes. A straight crossing
 * of a side street, or a jog along the same street, says nothing at all.
 */
export function walkingSteps(steps: NavStep[], line: WalkLine): NavStep[] {
  const out: NavStep[] = []
  const walks = (step: NavStep) => line.segments[step.segmentIndex]?.mode === 'walking'
  const firstOfSegment = (k: number) => k === 0 || steps[k - 1].segmentIndex !== steps[k].segmentIndex
  const mergeable = (k: number) => walks(steps[k]) && !firstOfSegment(k) && !FIXED.has(maneuverKind(steps[k].instruction))

  let i = 0
  while (i < steps.length) {
    if (!mergeable(i)) {
      out.push(steps[i++])
      continue
    }
    const start = i
    const first = steps[i]
    const reach = (step: NavStep) => crossingFrom(line.edges, step.startDistance - 1, step.startDistance + JOG_METERS)?.end ?? step.startDistance
    let j = i
    let end = Math.max(first.startDistance, reach(first))
    while (
      j + 1 < steps.length && mergeable(j + 1) && steps[j + 1].segmentIndex === first.segmentIndex
      && steps[j + 1].startDistance <= end + JOG_METERS && steps[j + 1].startDistance - first.startDistance <= MAX_SPAN_METERS
    ) {
      j++
      end = Math.max(end, reach(steps[j]))
    }
    const last = steps[j]
    const segment = line.segments[first.segmentIndex]
    const previous = steps[i - 1]
    const next = steps[j + 1]
    const a = first.startDistance
    const before = heading(line, Math.max(previous.startDistance, a - CHORD_METERS, segment.startDistance), a)
    const afterEnd = Math.min(next?.startDistance ?? segment.endDistance, end + CHORD_METERS, segment.endDistance)
    const after = heading(line, Math.min(end, afterEnd - MIN_CHORD_METERS), afterEnd)
    const kind = turnKind(angleDelta(before, after))

    const along = roadName(previous.instruction)
    const onto = roadName(last.instruction)
    const crossings = crossingsWithin(line.edges, a - 1, end)
    // Crossing the street walked along, to its other side, is worth saying even going straight.
    const sideSwitch = kind === 'straight' && !!along ? crossings.find(c => c.names.has(along)) : undefined
    const crossed = sideSwitch ?? crossings[0] ?? null
    const crossedFirst = kind === 'straight' || (!!crossed && Math.abs(angleDelta(before, heading(line, crossed.start, crossed.end))) < STRAIGHT_DEG)
    // Crossed before turning, it's the street turned onto; after, the one left behind.
    const named = crossed && ((sideSwitch && along) || crossed.edge.crossingName || (kind === 'straight' ? '' : crossedFirst ? onto : along))
    const road = named && (crossedFirst || named !== onto) ? named : ''
    const crossing: StepCrossing | undefined = crossed
      ? { signals: crossed.edge.crossing!.toLowerCase() === 'traffic_signals', first: crossedFirst, ...(road && { road }) }
      : undefined
    const special = marksPath(line, a) || marksPath(line, end)
    i = j + 1
    const ghKind = maneuverKind(last.instruction)
    // A lone fork between unnamed paths is a choice to make; on a street it's a sidewalk's kink.
    if (start === j && FORKS.has(ghKind) && !onto) {
      out.push(last)
      continue
    }
    if (kind === 'straight' && !special && !sideSwitch && (onto ? onto === along : !!along || !crossing)) continue

    const unchanged = start === j && ghKind === kind && !crossing
    out.push({
      ...last,
      startDistance: a,
      instruction: {
        ...last.instruction,
        type: kind === 'straight' ? 'continue' : 'turn',
        modifier: kind === 'uturn' ? 'u-turn' : kind,
        coordinate: first.instruction.coordinate,
        distance: steps.slice(start, j + 1).reduce((sum, s) => sum + (s.instruction.distance ?? 0), 0),
        text: unchanged ? last.instruction.text : '',
      },
      ...(crossing && { crossing }),
    })
  }
  return out.map((step, index) => ({ ...step, index }))
}
