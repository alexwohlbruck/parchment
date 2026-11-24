// Where the rider is on a station walk, from sensors where GPS can't follow:
// steps walked against each step's length, the climb a barometer reads on
// stairs, escalators and lifts, and a train pulling away at the end. A step no
// sensor can judge moves on after its expected time.

import type { GuidanceStep } from '@server/types/station-guidance.types'
import type { StationGuideTarget } from './station-guide'

export interface StationReading {
  nowMs: number
  /** Steps counted since the last reading; null without motion sensors. */
  steps: number | null
  /** Metres per step. */
  stride: number
  /** Motion sensors alone say the phone is at rest; null without them. */
  still: boolean | null
  /** Air pressure, hPa; null without a barometer. */
  pressure?: number | null
}

export interface StationProgress {
  key: string
  step: number
  /** Metres walked into the step. */
  along: number
  stepStartedMs: number
  /** Times its expected time a step is given before moving on by itself. */
  slack: number
  /** Smoothed pressure, hPa, and when it was last read. */
  pressure: number | null
  pressureMs: number | null
  /** Pressure on the level the rider last stood on. */
  levelPressure: number | null
  /** The climb, metres, over the last few seconds, so a finished climb can be told from one underway. */
  climbs: { atMs: number; metres: number; along: number }[]
  /** Since when the phone has been shaken without a step, as aboard a train. */
  ridingSince: number | null
  /** Pedometer readings are arriving. */
  stepping: boolean
  /** A train was sensed pulling away: the walk is over. */
  boarded: boolean
}

/** How the step shown is being followed: by a sensor, or a guess at the expected pace. */
export type StationConfidence = 'sensed' | 'timed'

export interface StationProgressView {
  step: GuidanceStep
  index: number
  total: number
  next: GuidanceStep | null
  confidence: StationConfidence
  /** Metres left on a step the pedometer follows. */
  metresLeft: number | null
  /** Until a timed step moves on by itself; null on the last step and on sensed ones. */
  advancesInMs: number | null
}

/** Air pressure falls about this much per metre climbed near sea level. */
export const HPA_PER_METRE = 0.12
const AUTO_ADVANCE_SLACK = 1.5
const MIN_STEP_MS = 8000
/** A walked step is given at least this many metres, so a short one is still seen. */
const MIN_STEP_METRES = 5
/** The least climb, per level, that counts as having changed level. */
const MIN_CLIMB_PER_LEVEL = 1.5
/** A climb that moves less than this ... */
const CLIMB_STEADY_METRES = 0.35
/** ... over this long is over. */
const CLIMB_SETTLE_MS = 3000
const PRESSURE_TIME_CONSTANT_MS = 500
/** Stale beyond this, a pressure is no longer the rider's. */
const PRESSURE_STALE_MS = 5000
/** Shaken this long without a step, the rider is on a moving train. */
const RIDE_SENSED_MS = 20_000

const STANDING_TYPES = new Set<GuidanceStep['type']>(['escalator', 'elevator'])

const levelsOf = (step: GuidanceStep) => step.levelChange ?? (step.fromLevel != null && step.toLevel != null ? step.toLevel - step.fromLevel : 0)
const changesLevel = (step: GuidanceStep) => levelsOf(step) !== 0

/** Slack that still has the steps done by the departure, for a rider walking at the expected pace. */
function slackFor(guide: StationGuideTarget, nowMs: number): number {
  const walkMs = guide.walk.seconds * 1000
  if (guide.departureMs == null || walkMs <= 0) return AUTO_ADVANCE_SLACK
  return Math.min(AUTO_ADVANCE_SLACK, Math.max(1, (guide.departureMs - nowMs) / walkMs))
}

const dueMs = (step: GuidanceStep, slack: number) => Math.max(MIN_STEP_MS, step.duration * 1000 * slack)

export function startProgress(guide: StationGuideTarget, nowMs: number): StationProgress {
  return {
    key: guide.key,
    step: 0,
    along: 0,
    stepStartedMs: nowMs,
    slack: slackFor(guide, nowMs),
    pressure: null,
    pressureMs: null,
    levelPressure: null,
    climbs: [],
    ridingSince: null,
    stepping: false,
    boarded: false,
  }
}

/** Onto step `to`; past a change of level, the pressure there is the new level's. */
function moveTo(state: StationProgress, steps: GuidanceStep[], to: number, nowMs: number, stepStartedMs = nowMs, along = 0): StationProgress {
  const moved = { ...state, step: to, along, stepStartedMs }
  return steps.slice(state.step, to).some(changesLevel) ? { ...moved, levelPressure: state.pressure, climbs: [] } : moved
}

/** The next step, by hand; null once the last one is done. */
export function advanceProgress(state: StationProgress, guide: StationGuideTarget, nowMs: number): StationProgress | null {
  return state.step + 1 < guide.walk.steps.length ? moveTo(state, guide.walk.steps, state.step + 1, nowMs) : null
}

const hasPressure = (state: StationProgress, nowMs: number) =>
  state.pressure != null && state.pressureMs != null && nowMs - state.pressureMs <= PRESSURE_STALE_MS

type Judge = 'climb' | 'stride' | 'timer' | 'hold'

/** The sensor that says when step `i` is done. */
function judgeOf(steps: GuidanceStep[], i: number, state: StationProgress, nowMs: number): Judge {
  const step = steps[i]
  if (i === steps.length - 1 || step.type === 'board') return 'hold'
  const barometer = hasPressure(state, nowMs)
  if (changesLevel(step) && barometer) return 'climb'
  if (step.bridged && barometer && steps[i + 1] && changesLevel(steps[i + 1])) return 'climb'
  if (state.stepping && !STANDING_TYPES.has(step.type)) return 'stride'
  return 'timer'
}

/** Climbed metres since the rider last stood on a level; positive up. */
const climbed = (state: StationProgress) =>
  state.pressure == null || state.levelPressure == null ? 0 : (state.levelPressure - state.pressure) / HPA_PER_METRE

/** Whether a finished climb matches the level change of `step`. */
function climbDone(step: GuidanceStep, state: StationProgress, nowMs: number): boolean {
  const levels = levelsOf(step)
  const metres = climbed(state)
  if (!levels || Math.sign(metres) !== Math.sign(levels) || Math.abs(metres) < MIN_CLIMB_PER_LEVEL * Math.abs(levels)) return false
  return climbSettled(state, nowMs)
}

/** Metres walked since the climb ended, which belong to the step after it. */
function sinceClimb({ climbs, along }: StationProgress, nowMs: number): number {
  const settledFrom = climbs.find(c => nowMs - c.atMs <= CLIMB_SETTLE_MS)
  return Math.max(0, along - (settledFrom?.along ?? along))
}

/** The climb has barely moved over the whole settling window. */
function climbSettled({ climbs }: StationProgress, nowMs: number): boolean {
  if (!climbs.length || nowMs - climbs[0].atMs < CLIMB_SETTLE_MS) return false
  const metres = climbs.filter(c => nowMs - c.atMs <= CLIMB_SETTLE_MS).map(c => c.metres)
  return Math.max(...metres) - Math.min(...metres) <= CLIMB_STEADY_METRES
}

/** The first step from `i` that changes level, across steps on one level only. */
function nextLevelStep(steps: GuidanceStep[], i: number): number | null {
  for (let j = i; j < steps.length; j++) if (changesLevel(steps[j])) return j
  return null
}

function sense(state: StationProgress, reading: StationReading): StationProgress {
  const { nowMs, pressure, steps, still } = reading
  let next: StationProgress = { ...state, stepping: steps != null }
  if (steps != null) next.along += steps * reading.stride
  if (pressure != null) {
    const dt = next.pressureMs == null ? Infinity : Math.max(0, nowMs - next.pressureMs)
    const smoothed = next.pressure == null || !hasPressure(next, nowMs) ? pressure : next.pressure + (pressure - next.pressure) * (1 - Math.exp(-dt / PRESSURE_TIME_CONSTANT_MS))
    next = { ...next, pressure: smoothed, pressureMs: nowMs, levelPressure: next.levelPressure ?? smoothed }
    const metres = climbed(next)
    next.climbs = [...next.climbs.filter(c => nowMs - c.atMs <= 2 * CLIMB_SETTLE_MS), { atMs: nowMs, metres, along: next.along }]
  }
  const shaken = steps === 0 && still === false
  next.ridingSince = shaken ? (next.ridingSince ?? nowMs) : null
  return next
}

/** Folds in a sensor reading and moves past the steps it shows are done, holding at the last. */
export function updateProgress(state: StationProgress, guide: StationGuideTarget, reading: StationReading): StationProgress {
  const steps = guide.walk.steps
  const { nowMs } = reading
  let next = sense(state, reading)
  const last = steps.length - 1
  if (!next.boarded && guide.kind !== 'egress' && next.ridingSince != null && nowMs - next.ridingSince >= RIDE_SENSED_MS && nextLevelStep(steps, next.step) == null) {
    return { ...moveTo(next, steps, last, nowMs), boarded: true }
  }
  if (next.step >= last) return next

  const step = steps[next.step]
  switch (judgeOf(steps, next.step, next, nowMs)) {
    case 'climb': {
      const target = changesLevel(step) ? next.step : next.step + 1
      return climbDone(steps[target], next, nowMs) ? moveTo(next, steps, Math.min(last, target + 1), nowMs, nowMs, sinceClimb(next, nowMs)) : next
    }
    case 'stride': {
      const ahead = hasPressure(next, nowMs) ? nextLevelStep(steps, next.step + 1) : null
      if (ahead != null && ahead < last && climbDone(steps[ahead], next, nowMs)) return moveTo(next, steps, ahead + 1, nowMs, nowMs, sinceClimb(next, nowMs))
      return next.along >= Math.max(MIN_STEP_METRES, step.distance) ? moveTo(next, steps, next.step + 1, nowMs) : next
    }
    case 'timer': {
      while (next.step < last && judgeOf(steps, next.step, next, nowMs) === 'timer' && nowMs - next.stepStartedMs >= dueMs(steps[next.step], next.slack)) {
        next = moveTo(next, steps, next.step + 1, nowMs, next.stepStartedMs + dueMs(steps[next.step], next.slack))
      }
      return next
    }
    case 'hold':
      return next
  }
}

export function progressView(state: StationProgress, guide: StationGuideTarget, nowMs: number): StationProgressView {
  const steps = guide.walk.steps
  const step = steps[state.step]
  const judge = judgeOf(steps, state.step, state, nowMs)
  const timed = judge === 'timer'
  return {
    step,
    index: state.step,
    total: steps.length,
    next: steps[state.step + 1] ?? null,
    confidence: timed || (judge === 'hold' && !state.stepping && !hasPressure(state, nowMs)) ? 'timed' : 'sensed',
    metresLeft: judge === 'stride' ? Math.max(0, Math.max(MIN_STEP_METRES, step.distance) - state.along) : null,
    advancesInMs: timed ? Math.max(0, state.stepStartedMs + dueMs(step, state.slack) - nowMs) : null,
  }
}
