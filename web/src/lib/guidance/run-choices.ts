import { approachReach, isOutOfReach, type DepartureReachability } from '@/lib/transit/transit-reachability'
import { SAME_RUN_MS } from '@/lib/transit/later-runs'
import type { CandidateSet, VehicleCandidate } from './vehicle-switch'

export interface RunChoice {
  candidate: VehicleCandidate
  reach: DepartureReachability
  /** At the stop the rider gets off, where the feed knows it. */
  arrivalMs?: number
  booked: boolean
}

export interface RunChoiceInput {
  set: CandidateSet
  bookedTripId?: string
  /** Stands in for the booked run when its trip id is unknown. */
  bookedMs: number
  alightStop: string | null
  nowMs: number
  walkSec: number
  runFactor?: number | null
}

const MAX_CHOICES = 8

/** The runs the rider can still make that get them off where planned, soonest first, the booked one marked. */
export function runChoices(input: RunChoiceInput): RunChoice[] {
  const { set, alightStop, nowMs, walkSec } = input
  const alightKnown = alightStop != null && set.known.includes(alightStop)
  const bookedId = input.bookedTripId ?? closestRun(set.candidates, input.bookedMs)?.tripId
  return set.candidates
    .flatMap(candidate => {
      const booked = candidate.tripId === bookedId
      const reach = approachReach(candidate.departureMs, nowMs, walkSec, input.runFactor ?? null)
      const arrivalMs = alightKnown ? candidate.calls.find(c => c.stop === alightStop)?.timeMs : undefined
      if (alightKnown && arrivalMs == null) return []
      if (isOutOfReach(reach) && !(booked && reach !== 'departed')) return []
      return [{ candidate, reach, arrivalMs, booked }]
    })
    .sort((a, b) => a.candidate.departureMs - b.candidate.departureMs)
    .slice(0, MAX_CHOICES)
}

function closestRun(runs: VehicleCandidate[], ms: number): VehicleCandidate | undefined {
  const near = runs.filter(r => Math.abs(r.departureMs - ms) <= SAME_RUN_MS)
  return near.sort((a, b) => Math.abs(a.departureMs - ms) - Math.abs(b.departureMs - ms))[0]
}
