// A ramp that switches back and forth, as up to a bridge, gets a hairpin step
// from the router at every corner; to a walker or rider it's one instruction.

import { bearingDeg } from '@/lib/map/movement-interpolation'
import { maneuverKind } from '@/lib/directions/maneuver'
import { angleDelta } from './spring'
import { climbDirection } from './vertical'
import type { NavStep } from './nav-route'
import type { WalkLine } from './walk-steps'

const HAIRPIN_DEG = 135
const CHORD_METERS = 12
/** Router steps this close are the corners of one hairpin. */
const CORNER_METERS = 20
/** Hairpins further apart than this are separate turns. */
const MAX_LEG_METERS = 150
/** A bridge this close to the ramp is the one it serves. */
const BRIDGE_REACH_METERS = 100
const MIN_RISE_METERS = 2

const RAMP_PATHS = new Set(['footway', 'path', 'cycleway'])
const ON_FOOT = new Set(['walking', 'cycling', 'biking'])

const roadName = (step: NavStep) => step.instruction.streetName || step.instruction.streetRef || ''

function onRamp(line: WalkLine, step: NavStep): boolean {
  const s = step.startDistance + CHORD_METERS / 2
  const edge = line.edges.find(e => e.startDistance <= s && e.endDistance >= s)
  return !!edge && RAMP_PATHS.has(edge.roadClass ?? '') && !edge.streetName && !step.crossing && maneuverKind(step.instruction) !== 'arrive'
}

function isHairpin(line: WalkLine, from: number, to: number): boolean {
  const before = bearingDeg(line.at(from - CHORD_METERS), line.at(from))
  const after = bearingDeg(line.at(to), line.at(to + CHORD_METERS))
  return Math.abs(angleDelta(before, after)) >= HAIRPIN_DEG
}

/** Index of the last step of a run of switchbacks starting at `i`, or -1. */
function rampEnd(steps: NavStep[], i: number, line: WalkLine): number {
  const first = steps[i]
  const segment = line.segments[first.segmentIndex]
  if (!ON_FOOT.has(segment?.mode ?? '') || steps[i - 1]?.segmentIndex !== first.segmentIndex) return -1
  const joins = (k: number) => steps[k]?.segmentIndex === first.segmentIndex && onRamp(line, steps[k]) && roadName(steps[k]) === roadName(first)
  let hairpins = 0
  let end = -1
  let k = i
  while (joins(k) && (end < 0 || steps[k].startDistance - steps[end].startDistance <= MAX_LEG_METERS)) {
    let corner = k
    while (joins(corner + 1) && steps[corner + 1].startDistance - steps[k].startDistance <= CORNER_METERS) corner++
    if (isHairpin(line, steps[k].startDistance, steps[corner].startDistance)) {
      hairpins++
      end = corner
    } else if (hairpins === 0) {
      return -1
    }
    k = corner + 1
  }
  return hairpins >= 2 ? end : -1
}

function rampShape(line: WalkLine, from: number, to: number): NonNullable<NavStep['ramp']> {
  const bridge = (a: number, b: number) => line.edges.some(e => e.roadEnvironment === 'bridge' && e.endDistance >= a && e.startDistance <= b)
  if (bridge(to, to + BRIDGE_REACH_METERS)) return { direction: 'up', bridge: true }
  if (bridge(from - BRIDGE_REACH_METERS, from)) return { direction: 'down', bridge: false }
  const direction = climbDirection(line.edges, from, to, MIN_RISE_METERS)
  return { ...(direction && { direction }), bridge: false }
}

export function rampSteps(steps: NavStep[], line: WalkLine): NavStep[] {
  const out: NavStep[] = []
  for (let i = 0; i < steps.length; i++) {
    const end = rampEnd(steps, i, line)
    if (end < 0) {
      out.push(steps[i])
      continue
    }
    out.push({ ...steps[i], ramp: rampShape(line, steps[i].startDistance, steps[end].startDistance) })
    i = end
  }
  return out.map((step, index) => ({ ...step, index }))
}
