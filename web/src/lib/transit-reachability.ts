/**
 * How catchable is a given departure, right now?
 *
 * The planner hands us a static approach walk ("7 min to the platform"), but a
 * rider reading the departure board has usually already spent part of it. Held
 * static, the board keeps insisting the rider is 7 minutes out while they stand
 * on the platform watching catchable trains read as missed. So the remaining
 * walk decays: from the live position when we have one, otherwise from the
 * plan's own schedule.
 *
 * The result is a hint, never a gate — see `departureReachability`.
 */

import type { LngLat } from '@/types/map.types'
import { distanceMeters } from './measure.utils'

/** Walking pace assumed when the plan carries no usable distance. */
const DEFAULT_WALK_SPEED_MPS = 1.35
/** Sane bounds for a pace inferred from the plan, so one odd leg can't imply
 *  a sprint or a crawl. */
const MIN_WALK_SPEED_MPS = 0.7
const MAX_WALK_SPEED_MPS = 2.2
/** Straight-line distance undershoots a real walking route — street grids and
 *  station entrances add roughly a third. */
const DETOUR_FACTOR = 1.3
/** A fix this coarse can't tell "at the platform" from "a block away". */
const MAX_USABLE_ACCURACY_M = 150

export interface AccessWalk {
  /** Moving seconds of the planned approach walk (excludes platform wait). */
  plannedSec: number
  /** When the plan has the rider reaching the stop (ms epoch), wait excluded. */
  arrivalMs?: number
  /** Metres of the planned approach walk, used to infer the rider's pace. */
  distanceM?: number
  /** The boarding stop, for the position-based estimate. */
  stop?: LngLat | null
  /** Live position; ignored when absent or too coarse to be meaningful. */
  position?: LngLat | null
  accuracyM?: number | null
}

/**
 * Seconds of approach walk still ahead of the rider. Never exceeds the planned
 * walk: the failure we care about is the board being too pessimistic, so when
 * the estimates disagree we trust the plan as the ceiling.
 */
export function remainingAccessWalkSec(walk: AccessWalk, nowMs: number): number {
  const planned = Math.max(0, walk.plannedSec)
  if (planned === 0) return 0

  // Position first — it reflects where the rider actually is, not where the
  // plan assumed they'd be.
  if (
    walk.stop &&
    walk.position &&
    (walk.accuracyM == null || walk.accuracyM <= MAX_USABLE_ACCURACY_M)
  ) {
    const pace = walk.distanceM
      ? clamp(walk.distanceM / planned, MIN_WALK_SPEED_MPS, MAX_WALK_SPEED_MPS)
      : DEFAULT_WALK_SPEED_MPS
    const remaining =
      (distanceMeters(walk.position, walk.stop) * DETOUR_FACTOR) / pace
    return clamp(remaining, 0, planned)
  }

  // Otherwise assume the rider is keeping to the plan: the walk burns down as
  // the clock passes its scheduled arrival at the stop.
  if (walk.arrivalMs != null) {
    return clamp((walk.arrivalMs - nowMs) / 1000, 0, planned)
  }

  return planned
}

/**
 * How a run reads on the board:
 *   • departed     — already gone
 *   • unreachable  — still upcoming, but not on foot from where the rider is
 *   • hurry        — you'd make it, but with less than your grace period spare
 *   • ok           — comfortable
 *
 * `graceSec` is the rider's own margin (the "arrive early" preference): how
 * much slack they want between reaching the platform and the doors closing.
 * At 0 they're happy to step straight on, and nothing ever reads as a hurry.
 *
 * All four are cosmetic. Rebooking is never gated on them: the rider knows
 * things we don't (they're on the platform, they'll run, they're being driven).
 */
export type DepartureReachability = 'departed' | 'unreachable' | 'hurry' | 'ok'

export function departureReachability(
  departureMs: number,
  nowMs: number,
  remainingWalkSec: number,
  graceSec = 0,
): DepartureReachability {
  const leadMs = departureMs - nowMs
  if (leadMs < 0) return 'departed'
  const walkMs = Math.max(0, remainingWalkSec) * 1000
  if (leadMs < walkMs) return 'unreachable'
  // Comfortable means the walk *plus* the rider's margin fits in the lead.
  const comfortableMs = walkMs + Math.max(0, graceSec) * 1000
  if (comfortableMs > 0 && leadMs < comfortableMs) return 'hurry'
  return 'ok'
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}
