// Reads a route step into a structured instruction: what the traveller does,
// onto what, by which landmark and lane. Words come later, in instruction-text.

import { maneuverKind, type ManeuverKind } from '@/lib/directions/maneuver'
import { bearingAt, edgeAt, type NavRoute, type NavStep } from '../nav-route'
import { stepRoad, travelModeAt, type RoadLabel } from '../guidance-display'
import { laneHint, type LanePlan } from '../lanes'
import { angleDelta } from '../spring'
import { cardinal } from '../turn-around'
import { landmarkAnchor } from './anchors'
import type { Action, LaneAdvice, RichInstruction, Side } from './instruction.types'

export interface InstructionContext {
  /** The traveller's route distance: landmarks are counted from here. */
  from: number
  speed: number
  lanes?: LanePlan | null
  destinationSide?: Side | null
  home?: boolean
}

/** Just past the maneuver, where the road taken is read. */
const PAST_TURN_METERS = 8
const CROSSING_REACH_METERS = 20
const ROUNDABOUT_PROBE_METERS = 10
const THROUGH_DEGREES = 25
const IMMEDIATE_METERS = 40
const IMMEDIATE_SEC = 5

const MOTORWAYS = new Set(['motorway', 'trunk'])
const PATHS = new Set(['footway', 'path', 'pedestrian', 'cycleway'])
const CROSSINGS = new Set(['MARKED', 'UNMARKED', 'TRAFFIC_SIGNALS', 'UNCONTROLLED'])
/** Unnamed road classes a walker or rider can be told to follow. */
const FOLLOWABLE = new Set(['path', 'pedestrian', 'cycleway', 'steps', 'track'])
const ON_FOOT = new Set(['walking', 'cycling', 'biking'])

function sideOf(kind: ManeuverKind): Side | null {
  if (kind.endsWith('left')) return 'left'
  if (kind.endsWith('right')) return 'right'
  return null
}

const roadClassAt = (route: NavRoute, s: number) => edgeAt(route, s)?.roadClass ?? ''

/**
 * The road the step leads onto. Where sidewalks and paths gain their street's
 * name, or names change along a step, this is the one place that reads them.
 */
export function targetRoad(route: NavRoute, step: NavStep): RoadLabel | undefined {
  const road = stepRoad(route, step, Math.min(route.length, step.startDistance + PAST_TURN_METERS))
  if (road.kind === 'named') return road
  return FOLLOWABLE.has(road.key) ? road : undefined
}

function sameRoad(route: NavRoute, step: NavStep): boolean {
  const name = step.instruction.streetName || step.instruction.streetRef
  const before = route.steps[step.index - 1]?.instruction
  return !!name && !!before && (before.streetName || before.streetRef) === name
}

function roundaboutAction(route: NavRoute, step: NavStep): Action {
  const entry = step.startDistance
  const exit = step.instruction.distance > 0 ? entry + step.instruction.distance : route.steps[step.index + 1]?.startDistance
  const through = exit != null && exit + ROUNDABOUT_PROBE_METERS < route.length
    && Math.abs(angleDelta(bearingAt(route, entry - ROUNDABOUT_PROBE_METERS), bearingAt(route, exit + ROUNDABOUT_PROBE_METERS))) <= THROUGH_DEGREES
  return { kind: 'roundabout', exit: step.instruction.exitNumber ?? null, through }
}

/** On foot or by bike: the path's own shape, when it's stairs, a footbridge or a crossing. */
function pathAction(route: NavRoute, step: NavStep, side: Side | null): Action | null {
  const past = edgeAt(route, step.startDistance + PAST_TURN_METERS)
  if (past?.roadClass === 'steps') return { kind: 'stairs', side }
  if (past?.roadEnvironment === 'bridge' && PATHS.has(past.roadClass ?? '')) return { kind: 'footbridge' }
  const crossing = route.edges.find(
    e => e.startDistance >= step.startDistance - 1 && e.startDistance <= step.startDistance + CROSSING_REACH_METERS && CROSSINGS.has(e.crossing ?? ''),
  )
  return crossing ? { kind: 'crosswalk', signals: crossing.crossing === 'TRAFFIC_SIGNALS' } : null
}

/** Lanes turn both ways and none goes on: the road ends at the junction. */
function endsAhead(plan: LanePlan): boolean {
  const arrows = new Set(plan.lanes.flatMap(l => l.arrows))
  return !arrows.has('through') && [...arrows].some(a => a.endsWith('left')) && [...arrows].some(a => a.endsWith('right'))
}

function isExit(route: NavRoute, step: NavStep, mode: string): boolean {
  if (mode !== 'driving') return false
  if (step.instruction.exitRef) return true
  const before = roadClassAt(route, step.startDistance - PAST_TURN_METERS)
  return MOTORWAYS.has(before) && roadClassAt(route, step.startDistance + PAST_TURN_METERS).endsWith('_link')
}

function action(route: NavRoute, step: NavStep, kind: ManeuverKind, context: InstructionContext): Action {
  const mode = travelModeAt(route, step.startDistance)
  const side = sideOf(kind)
  if (kind === 'arrive') return { kind: 'arrive', side: context.destinationSide ?? null, home: !!context.home }
  if (kind === 'roundabout') return roundaboutAction(route, step)
  if (ON_FOOT.has(mode)) {
    const onPath = pathAction(route, step, kind === 'uturn' ? null : side)
    if (onPath) return onPath
  }
  if ((kind === 'keep-left' || kind === 'keep-right' || kind === 'slight-left' || kind === 'slight-right') && side && isExit(route, step, mode)) {
    return { kind: 'exit', side, ...(step.instruction.exitRef && { number: step.instruction.exitRef }) }
  }
  if (kind === 'keep-left' || kind === 'keep-right') return sameRoad(route, step) ? { kind: 'stay', maneuver: kind } : { kind: 'fork', side: side! }
  if ((kind === 'left' || kind === 'right') && context.lanes && endsAhead(context.lanes)) return { kind: 'end-of-road', side: kind }
  if (kind === 'straight' && sameRoad(route, step)) return { kind: 'stay', maneuver: kind }
  return { kind: 'turn', maneuver: kind }
}

/** The lanes to be in, when not every lane will do. */
export function laneAdvice(plan: LanePlan): LaneAdvice | undefined {
  const hint = laneHint(plan)
  if (!hint) return undefined
  if (hint.count > 1) return { kind: 'lanes', side: hint.side, count: hint.count }
  const index = plan.lanes.findIndex(l => l.valid)
  const fromLeft = index + 1
  const fromRight = plan.lanes.length - index
  if (fromLeft === fromRight) return { kind: 'lanes', side: 'middle', count: 1 }
  return fromLeft < fromRight ? { kind: 'lane', from: 'left', ordinal: fromLeft } : { kind: 'lane', from: 'right', ordinal: fromRight }
}

export function richInstruction(route: NavRoute, step: NavStep, context: InstructionContext): RichInstruction {
  const maneuver = maneuverKind(step.instruction)
  const instruction: RichInstruction = { action: action(route, step, maneuver, context), maneuver }
  if (maneuver === 'arrive') return instruction
  const target = targetRoad(route, step)
  if (target) instruction.target = target
  if (step.instruction.destination) instruction.toward = step.instruction.destination
  const anchor = landmarkAnchor(route, step, context.from, context.speed, travelModeAt(route, step.startDistance))
  if (anchor) instruction.anchor = anchor
  const lanes = context.lanes && laneAdvice(context.lanes)
  if (lanes) instruction.lanes = lanes
  return instruction
}

/** How the route sets off: the heading, and the road it follows. */
export function departure(route: NavRoute, step: NavStep | null): RichInstruction {
  const mode = travelModeAt(route, 0)
  const instruction: RichInstruction = {
    action: { kind: 'depart', heading: cardinal(bearingAt(route, 0)), along: ON_FOOT.has(mode) },
    maneuver: 'straight',
  }
  const target = step ? targetRoad(route, step) : undefined
  if (target) instruction.target = target
  return instruction
}

/** `first` followed by `next`, which comes `gap` metres later. */
export function chained(first: RichInstruction, next: RichInstruction, gap: number, speed: number): RichInstruction {
  const immediately = gap <= IMMEDIATE_METERS || (speed > 0.5 && gap / speed <= IMMEDIATE_SEC)
  const { anchor: _anchor, lanes: _lanes, then: _then, ...bare } = next
  return { ...first, then: { instruction: bare, immediately } }
}
