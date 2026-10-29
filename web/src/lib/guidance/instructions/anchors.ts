// The landmark to hang a maneuver on: a light, a sign, a bridge the traveller
// sees just before it. Never one that could be mistaken for another nearby.

import type { RouteHazardKind } from '@/types/directions.types'
import type { NavRoute, NavStep } from '../nav-route'
import type { Anchor, AnchorKind } from './instruction.types'

/** A light this far before the turn, or this far past its node, is the turn's own. */
const AT_BEFORE_METERS = 25
const AT_PAST_METERS = 10
/** Two lights this close read as one: neither can be named alone. */
const CLUSTER_METERS = 50
const MAX_ORDINAL = 3
/** Too close to the traveller to count: they may be stopped at it. */
const NEAR_METERS = 8
/** How far before the turn an "after" landmark may be, in seconds of travel, within bounds. */
const AFTER_SEC = 8
const AFTER_METERS: Record<string, [number, number]> = { walking: [15, 40], driving: [60, 150] }
const MIN_STRETCH_METERS = 15
/** "Go past this intersection": one just ahead of the traveller, the turn some way beyond. */
const PAST_REACH_METERS = 100
const PAST_CLEARANCE_METERS = 40
const PAST_TURN_WITHIN_METERS = 200

const SALIENCE: Record<AnchorKind, number> = {
  traffic_signals: 3,
  stop: 3,
  tunnel: 2.5,
  give_way: 2,
  rail_crossing: 2,
  bridge: 2,
  overpass: 2,
  intersection: 1,
}
const RELATION: Record<Anchor['relation'], number> = { at: 2, after: 1, past: 0.5 }

const CONTROLS = new Set<RouteHazardKind>(['traffic_signals', 'stop', 'give_way'])

function score(anchor: Anchor, turn: number): number {
  return SALIENCE[anchor.kind] + RELATION[anchor.relation] - Math.abs(turn - anchor.s) / 100
}

function afterWindow(mode: string, speed: number): number {
  const [min, max] = AFTER_METERS[mode === 'walking' ? 'walking' : 'driving']
  return Math.min(max, Math.max(min, speed * AFTER_SEC))
}

const isolated = (points: number[], s: number) => !points.some(p => p !== s && Math.abs(p - s) < CLUSTER_METERS)

/** A light the turn is at, counted from the traveller, or the light just before it. */
function lightAnchor(lights: number[], from: number, turn: number, reach: number): Anchor | null {
  const ahead = lights.filter(s => s > from + NEAR_METERS && s <= turn + AT_PAST_METERS)
  const last = ahead.at(-1)
  if (last == null || !isolated(lights, last)) return null
  if (last >= turn - AT_BEFORE_METERS) {
    const countable = ahead.every(s => isolated(lights, s))
    return countable && ahead.length <= MAX_ORDINAL ? { kind: 'traffic_signals', relation: 'at', ordinal: ahead.length, s: last } : null
  }
  return turn - last <= reach ? { kind: 'traffic_signals', relation: 'after', s: last } : null
}

function pointAnchor(kind: AnchorKind, points: number[], from: number, turn: number, reach: number): Anchor | null {
  const last = points.filter(s => s > from + NEAR_METERS && s <= turn + AT_PAST_METERS).at(-1)
  if (last == null || !isolated(points, last)) return null
  if (last >= turn - AT_BEFORE_METERS) return kind === 'rail_crossing' ? null : { kind, relation: 'at', s: last }
  return turn - last <= reach ? { kind, relation: 'after', s: last } : null
}

/** Bridges and tunnels that end just before the turn. */
function stretchAnchors(route: NavRoute, from: number, turn: number, reach: number): Anchor[] {
  const anchors: Anchor[] = []
  let run: { kind: 'bridge' | 'tunnel'; start: number; end: number } | null = null
  const close = () => {
    if (run && run.end - run.start >= MIN_STRETCH_METERS && run.end > from && run.end <= turn - 5 && turn - run.end <= reach) {
      anchors.push({ kind: run.kind, relation: 'after', s: run.end })
    }
    run = null
  }
  for (const edge of route.edges) {
    if (edge.startDistance > turn) break
    const kind = edge.roadEnvironment === 'bridge' || edge.roadEnvironment === 'tunnel' ? edge.roadEnvironment : null
    if (run && (kind !== run.kind || edge.startDistance - run.end > 1)) close()
    if (!kind) continue
    if (run) run.end = edge.endDistance
    else run = { kind, start: edge.startDistance, end: edge.endDistance }
  }
  close()
  return anchors
}

/** Where the route comes out from under each overpass. */
function overpassEnds(route: NavRoute, until: number): number[] {
  const ends: number[] = []
  let open = false
  for (const edge of route.edges) {
    if (edge.startDistance > until) break
    if (edge.overpass) {
      if (open && edge.startDistance - ends[ends.length - 1] <= 1) ends[ends.length - 1] = edge.endDistance
      else ends.push(edge.endDistance)
      open = true
    } else open = false
  }
  return ends
}

/** The overpass just passed before the turn, when it's the only one between the traveller and the turn. */
function overpassAnchor(route: NavRoute, from: number, turn: number, reach: number): Anchor | null {
  const ahead = overpassEnds(route, turn + AT_PAST_METERS).filter(s => s > from + NEAR_METERS)
  if (ahead.length !== 1) return null
  const [end] = ahead
  return end <= turn - 5 && turn - end <= reach ? { kind: 'overpass', relation: 'after', s: end } : null
}

/** The controlled intersection just ahead of the traveller, when the turn is beyond it. */
function pastAnchor(controls: number[], from: number, turn: number): Anchor | null {
  const next = controls.find(s => s > from + NEAR_METERS)
  if (next == null || next - from > PAST_REACH_METERS || turn - next > PAST_TURN_WITHIN_METERS) return null
  if (next > turn - AT_BEFORE_METERS - PAST_CLEARANCE_METERS) return null
  const beyond = controls.filter(s => s > next + CLUSTER_METERS && s < turn - AT_BEFORE_METERS)
  return beyond.length ? null : { kind: 'intersection', relation: 'past', s: next }
}

/** The most salient unambiguous landmark for `step`, seen from route distance `from`. */
export function landmarkAnchor(route: NavRoute, step: NavStep, from: number, speed: number, mode: string): Anchor | null {
  const turn = step.startDistance
  const reach = afterWindow(mode, speed)
  const positions = (kinds: RouteHazardKind[]) =>
    route.hazards.filter(h => kinds.includes(h.kind) && h.startDistance <= turn + CLUSTER_METERS).map(h => h.startDistance)
  const walking = mode === 'walking'

  const candidates = [
    lightAnchor(positions(['traffic_signals']), from, turn, reach),
    walking ? null : pointAnchor('stop', positions(['stop']), from, turn, reach),
    walking ? null : pointAnchor('give_way', positions(['give_way']), from, turn, reach),
    pointAnchor('rail_crossing', positions(['rail_crossing']), from, turn, reach),
    ...stretchAnchors(route, from, turn, reach),
    overpassAnchor(route, from, turn, reach),
    walking ? null : pastAnchor(route.hazards.filter(h => CONTROLS.has(h.kind)).map(h => h.startDistance), from, turn),
  ].filter((a): a is Anchor => a != null)

  return candidates.reduce<Anchor | null>((best, a) => (!best || score(a, turn) > score(best, turn) ? a : best), null)
}
