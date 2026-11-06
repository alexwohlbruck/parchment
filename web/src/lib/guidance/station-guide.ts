// Step-by-step guidance through a station, where GPS can't follow: the
// walk from the entrance down to the platform, between two rides, and from
// the platform up to the street.

import type { GuidanceStep, StationWalk } from '@server/types/station-guidance.types'
import { isWalked, platformSpot, type GuidedSegment, type PlatformSpot, type StationWalkKind } from '@/lib/transit/station/station-walks'
import type { TransitStage } from './transit-progress'

export interface StationGuideTarget {
  key: string
  kind: StationWalkKind
  ride: number
  walk: StationWalk & { steps: GuidanceStep[] }
  /** When the ride walked to leaves; null leaving the station. */
  departureMs: number | null
  spot: PlatformSpot | null
}

export interface StationGuideState {
  key: string
  step: number
  stepStartedMs: number
  /** Times its expected time a step is given before moving on. */
  slack: number
}

export interface StationGuideView {
  step: GuidanceStep
  index: number
  total: number
  next: GuidanceStep | null
  /** Until the step moves on by itself; null on the last step, which waits to be done. */
  advancesInMs: number | null
}

/** On the street walk away from a station by this much, GPS has the rider again. */
export const STREET_RESUME_METERS = 30
/** A step is given this many times its expected time before moving on by itself. */
export const AUTO_ADVANCE_SLACK = 1.5
const MIN_STEP_MS = 8000

const guidable = (walk: StationWalk | null | undefined): walk is StationGuideTarget['walk'] =>
  isWalked(walk) && !!walk.steps?.length

function target(
  segments: GuidedSegment[],
  kind: StationWalkKind,
  ride: number,
  walk: StationWalk | null | undefined,
  departureMs: number | null = null,
): StationGuideTarget | null {
  if (!guidable(walk)) return null
  return { key: `${kind}:${ride}`, kind, ride, walk, departureMs, spot: platformSpot(segments, kind, ride) }
}

/** The ride before `index`, when nothing but a walk inside the station lies between. */
function changesFrom(segments: GuidedSegment[], index: number): boolean {
  const previous = segments[index - 1]
  return previous?.mode === 'transit' || (previous?.mode === 'walking' && segments[index - 2]?.mode === 'transit')
}

/**
 * The station walk the rider is on: heading for a ride's platform from
 * another ride or from the entrance, or leaving the last ride for the street
 * until GPS shows them walking away. `into` is how far into the current
 * segment the rider is.
 */
export function stationGuideTarget(
  segments: GuidedSegment[],
  stage: TransitStage | null,
  current: { index: number; into: number } | null,
): StationGuideTarget | null {
  if (stage?.kind === 'to-stop' || stage?.kind === 'wait') {
    const ride = segments[stage.segmentIndex]
    if (changesFrom(segments, stage.segmentIndex)) return target(segments, 'transfer', stage.segmentIndex, ride?.transfer?.walk, stage.departureMs)
    return stage.kind === 'wait' ? target(segments, 'access', stage.segmentIndex, ride?.entrance?.walk, stage.departureMs) : null
  }
  if (stage || !current || segments[current.index]?.mode !== 'walking' || current.into >= STREET_RESUME_METERS) return null
  const ride = current.index - 1
  return segments[ride]?.mode === 'transit' ? target(segments, 'egress', ride, segments[ride].exit?.walk) : null
}

/** Slack that still has the steps done by the departure, for a rider walking at the expected pace. */
function slackFor(guide: StationGuideTarget, nowMs: number): number {
  const walkMs = guide.walk.seconds * 1000
  if (guide.departureMs == null || walkMs <= 0) return AUTO_ADVANCE_SLACK
  return Math.min(AUTO_ADVANCE_SLACK, Math.max(1, (guide.departureMs - nowMs) / walkMs))
}

export function startGuide(guide: StationGuideTarget, nowMs: number): StationGuideState {
  return { key: guide.key, step: 0, stepStartedMs: nowMs, slack: slackFor(guide, nowMs) }
}

const dueMs = (step: GuidanceStep, slack: number) => Math.max(MIN_STEP_MS, step.duration * 1000 * slack)

/** The next step, or null once the last one is done. */
export function advanceGuide(state: StationGuideState, guide: StationGuideTarget, nowMs: number): StationGuideState | null {
  return state.step + 1 < guide.walk.steps.length ? { ...state, step: state.step + 1, stepStartedMs: nowMs } : null
}

/** Moves past steps whose time is up, holding at the last. */
export function autoAdvance(state: StationGuideState, guide: StationGuideTarget, nowMs: number): StationGuideState {
  let next = state
  const last = guide.walk.steps.length - 1
  while (next.step < last && nowMs - next.stepStartedMs >= dueMs(guide.walk.steps[next.step], next.slack)) {
    next = { ...next, step: next.step + 1, stepStartedMs: next.stepStartedMs + dueMs(guide.walk.steps[next.step], next.slack) }
  }
  return next
}

export function guideView(state: StationGuideState, guide: StationGuideTarget, nowMs: number): StationGuideView {
  const steps = guide.walk.steps
  const step = steps[state.step]
  const last = state.step === steps.length - 1
  return {
    step,
    index: state.step,
    total: steps.length,
    next: steps[state.step + 1] ?? null,
    advancesInMs: last ? null : Math.max(0, state.stepStartedMs + dueMs(step, state.slack) - nowMs),
  }
}
