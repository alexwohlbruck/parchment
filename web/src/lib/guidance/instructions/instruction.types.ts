// A spoken or shown instruction as parts, so the generator never builds a
// sentence: what to do, onto what, past which landmark, in which lane.

import type { ManeuverKind } from '@/lib/directions/maneuver'
import type { RoadLabel } from '../guidance-display'
import type { Cardinal } from '../turn-around'

export type Side = 'left' | 'right'

export type AnchorKind = 'traffic_signals' | 'stop' | 'give_way' | 'rail_crossing' | 'bridge' | 'tunnel' | 'intersection'

/**
 * A landmark the traveller sees just before the maneuver. `at`: the maneuver is
 * at it; `after`: it's passed just before; `past`: an intersection to go
 * through first, so the turn isn't taken early.
 */
export interface Anchor {
  kind: AnchorKind
  relation: 'at' | 'after' | 'past'
  /** Counted from the traveller, for a light the maneuver is at. */
  ordinal?: number
  /** Route distance of the landmark. */
  s: number
}

export type Action =
  | { kind: 'turn'; maneuver: ManeuverKind }
  | { kind: 'fork'; side: Side }
  | { kind: 'end-of-road'; side: Side }
  /** Straight on or keeping to one side, without leaving the road. */
  | { kind: 'stay'; maneuver: ManeuverKind }
  | { kind: 'exit'; side: Side; number?: string }
  | { kind: 'roundabout'; exit: number | null; through: boolean }
  | { kind: 'stairs'; side: Side | null }
  | { kind: 'footbridge' }
  | { kind: 'crosswalk'; signals: boolean }
  | { kind: 'arrive'; side: Side | null; home: boolean }
  | { kind: 'depart'; heading: Cardinal; along: boolean }

/** Which lanes to be in: one lane by its place from an edge, or a run of lanes on one side. */
export type LaneAdvice =
  | { kind: 'lane'; from: Side; ordinal: number }
  | { kind: 'lanes'; side: Side | 'middle'; count: number }

export interface RichInstruction {
  action: Action
  /** The maneuver the action makes, for lane advice and chaining. */
  maneuver: ManeuverKind
  target?: RoadLabel
  /** Where the signs point. */
  toward?: string
  anchor?: Anchor
  lanes?: LaneAdvice
  then?: { instruction: RichInstruction; immediately: boolean }
}
