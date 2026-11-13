import { approachReach, isOutOfReach, type DepartureReachability } from '@/lib/transit/transit-reachability'
import { SAME_RUN_MS } from '@/lib/transit/run'
import type { CandidateSet, VehicleCandidate } from './vehicle-switch'

export interface RunChoice {
  candidate: VehicleCandidate
  reach: DepartureReachability
  /** At the stop the rider gets off, where the feed knows it. */
  arrivalMs?: number
  /** Time left over at the stop before it leaves, at a walk. */
  spareSec: number
  booked: boolean
}

export interface RunChoiceInput {
  set: CandidateSet
  bookedTripId?: string
  /** Stands in for the booked run when its trip id is unknown. */
  bookedMs: number
  alightStop: string | null
  nowMs: number
  toStopSec: number
  runFactor?: number | null
}

const MAX_CHOICES = 8

/** The runs the rider can still make that get them off where planned, soonest first, the booked one marked. */
export function runChoices(input: RunChoiceInput): RunChoice[] {
  const { set, alightStop, nowMs, toStopSec } = input
  const alightKnown = alightStop != null && set.known.includes(alightStop)
  const bookedId = input.bookedTripId ?? closestRun(set.candidates, input.bookedMs)?.tripId
  return set.candidates
    .flatMap(candidate => {
      const booked = candidate.tripId === bookedId
      const reach = approachReach(candidate.departureMs, nowMs, toStopSec, input.runFactor ?? null)
      const arrivalMs = alightKnown ? candidate.calls.find(c => c.stop === alightStop)?.timeMs : undefined
      if (alightKnown && arrivalMs == null) return []
      if (isOutOfReach(reach) && !(booked && reach !== 'departed')) return []
      const spareSec = (candidate.departureMs - nowMs) / 1000 - toStopSec
      return [{ candidate, reach, arrivalMs, spareSec, booked }]
    })
    .sort((a, b) => a.candidate.departureMs - b.candidate.departureMs)
    .slice(0, MAX_CHOICES)
}

/** The runs listed after the booked one, for the line that names what follows it. */
export function followingRuns(choices: RunChoice[], bookedMs: number, count = 2): RunChoice[] {
  return choices.filter(c => !c.booked && c.candidate.departureMs > bookedMs + SAME_RUN_MS).slice(0, count)
}

function closestRun(runs: VehicleCandidate[], ms: number): VehicleCandidate | undefined {
  const near = runs.filter(r => Math.abs(r.departureMs - ms) <= SAME_RUN_MS)
  return near.sort((a, b) => Math.abs(a.departureMs - ms) - Math.abs(b.departureMs - ms))[0]
}
