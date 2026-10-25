// The bubble pinned to the next turn: the road it turns onto, on the side it turns to.

import { maneuverKind, type ManeuverKind } from '@/lib/directions/maneuver'
import { stepRoad, type RoadLabel } from './guidance-display'
import type { NavRoute, NavStep } from './nav-route'

export type CalloutSide = 'left' | 'right'

export interface TurnCallout {
  /** Route distance of the turn. */
  at: number
  side: CalloutSide
  road: RoadLabel
}

const LEFT: ReadonlySet<ManeuverKind> = new Set(['left', 'slight-left', 'sharp-left', 'keep-left', 'uturn'])
/** Just past the turn, where the road class of an unnamed road is read. */
const PAST_TURN_METERS = 5

export function turnCallout(route: NavRoute, step: NavStep): TurnCallout {
  return {
    at: step.startDistance,
    side: LEFT.has(maneuverKind(step.instruction)) ? 'left' : 'right',
    road: stepRoad(route, step, Math.min(route.length, step.startDistance + PAST_TURN_METERS)),
  }
}
