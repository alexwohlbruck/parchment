// On foot, GraphHopper turns at every kink of a sidewalk and crosswalk. Steps
// that close together are one maneuver, read from the heading before and after
// them, with the street crossed on the way as a detail of it.

import type { LngLat } from '@/types/map.types'
import type { RouteInstruction } from '@/types/directions.types'
import { maneuverKind, type ManeuverKind } from '@/lib/directions/maneuver'
import { bearingDeg } from '@/lib/map/movement-interpolation'
import { angleDelta } from './spring'
import type { CrossingWay, NavEdge, NavSegment, NavStep, StepCrossing } from './nav-route'
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
/** Two crossings this close, from one corner to the next, are a diagonal across the junction. */
const DIAGONAL_GAP_METERS = 25

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

export interface Crossed { start: number; end: number; edge: NavEdge; edges: NavEdge[]; names: Set<string> }

/** The crossings, each joined across islands, that start within `[from, to]`. */
export function crossingsWithin(edges: NavEdge[], from: number, to: number): Crossed[] {
  const found: Crossed[] = []
  for (let k = 0; k < edges.length && edges[k].startDistance <= to; k++) {
    if (edges[k].startDistance < from || !isCrossing(edges[k])) continue
    let end = edges[k].endDistance
    let i = k + 1
    for (; i < edges.length && edges[i].startDistance - end <= 1 && isCrossing(edges[i]); i++) end = edges[i].endDistance
    const parts = edges.slice(k, i)
    const names = new Set(parts.flatMap(e => e.crossingName ?? []))
    // A sidewalk carries the tag of a crossing node along it; a crosswalk is short.
    if (end - edges[k].startDistance <= MAX_CROSSING_METERS) found.push({ start: edges[k].startDistance, end, edge: edges[k], edges: parts, names })
    k = i - 1
  }
  return found
}

const crossingFrom = (edges: NavEdge[], from: number, to: number): Crossed | null => crossingsWithin(edges, from, to)[0] ?? null

/** "Eastern Parkway" and its service road are one street to cross. */
export const sameStreet = (a: string, b: string) => a.startsWith(b) || b.startsWith(a)

const signalled = (c: Crossed) => c.edge.crossing!.toLowerCase() === 'traffic_signals'

function crossingWay(c: Crossed): CrossingWay {
  const any = (key: 'crossingIsland' | 'buttonOperated' | 'crossingDiagonal') => c.edges.some(e => e[key])
  return {
    ...(c.edge.crossing!.toLowerCase() === 'unmarked' && { unmarked: true }),
    ...(any('crossingIsland') && { island: true }),
    ...(any('buttonOperated') && { button: true }),
    ...(any('crossingDiagonal') && { diagonal: true }),
  }
}

/** The other street crossed at a diagonal corner, just before or after `crossed`, starting within `(from, to)`. */
function diagonalPartner(edges: NavEdge[], crossed: Crossed, road: string, from: number, to: number) {
  const near = crossingsWithin(edges, Math.max(from, crossed.start - DIAGONAL_GAP_METERS - MAX_CROSSING_METERS), Math.min(to, crossed.end + DIAGONAL_GAP_METERS))
  for (const c of near) {
    const name = [...c.names][0]
    if (c.start === crossed.start || !name || sameStreet(name, road)) continue
    const before = c.start < crossed.start
    if ((before ? crossed.start - c.end : c.start - crossed.end) <= DIAGONAL_GAP_METERS) return { name, before }
  }
  return null
}

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

  // Where the last maneuver told ended: crossings before it are already spoken for.
  let claimed = -Infinity
  let i = 0
  while (i < steps.length) {
    if (!mergeable(i)) {
      claimed = steps[i].startDistance
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
    // Doubling back: on to the crossing, over, and back the way they came on the other side.
    const back = kind === 'uturn'
    const crossings = crossingsWithin(line.edges, a - 1, end)
    // Crossing the street walked along, to its other side, is worth saying even going straight.
    const sideSwitch = kind === 'straight' && !!along ? crossings.find(c => c.names.has(along)) : undefined
    const crossed = sideSwitch ?? crossings[0] ?? null
    const crossedFirst = kind === 'straight' || back || (!!crossed && Math.abs(angleDelta(before, heading(line, crossed.start, crossed.end))) < STRAIGHT_DEG)
    // Crossed before turning, it's the street turned onto; after, the one left behind.
    const named = crossed && ((sideSwitch && along) || crossed.edge.crossingName || (kind === 'straight' ? '' : crossedFirst ? onto : along))
    // Turning onto a street takes the walker across the one left behind; across the one turned onto is a sidewalk's tag.
    const implied = !!crossed && !crossedFirst && !!onto && (!named || named === along || named === onto)
    const road = named && (named !== onto || (crossedFirst && !back)) ? named : ''
    const partner = kind === 'straight' && crossed && road ? diagonalPartner(line.edges, crossed, road, claimed, (next?.startDistance ?? Infinity) - 2) : null
    const corner = (back || sideSwitch) && crossed && !partner
      ? steps.slice(start, j + 1).map(s => roadName(s.instruction)).find(n => n && n !== along && n !== onto && n !== named)
      : undefined
    const signals = !!crossed && signalled(crossed)
    const passedUnsignalled = crossingsWithin(line.edges, claimed, a - 2).some(c => !signalled(c))
    // At an ordinary corner it's the crosswalk; the light only when it, not the corner, says which.
    const light = signals && (back || (!!sideSwitch && !partner && (!corner || passedUnsignalled)))
    const crossing: StepCrossing | undefined = crossed && !implied
      ? {
          signals,
          first: crossedFirst,
          ...(road && { road: partner?.before ? partner.name : road }),
          ...(partner && { then: partner.before ? road : partner.name }),
          ...(corner && { at: corner }),
          ...(light && { light }),
          ...crossingWay(crossed),
        }
      : undefined
    const special = marksPath(line, a) || marksPath(line, end)
    i = j + 1
    const ghKind = maneuverKind(last.instruction)
    // A lone fork between unnamed paths is a choice to make; on a street it's a sidewalk's kink.
    if (start === j && FORKS.has(ghKind) && !onto) {
      claimed = end
      out.push(crossing?.road ? { ...last, crossing } : last)
      continue
    }
    // Straight on, a new name or a side street crossed is no maneuver.
    if (kind === 'straight' && !special && !sideSwitch && (!!along || !crossing)) continue
    claimed = end

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
