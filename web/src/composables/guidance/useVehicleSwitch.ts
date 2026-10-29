import { onScopeDispose, shallowRef, watch } from 'vue'
import { useGuidanceStore } from '@/stores/guidance.store'
import { rideStops, walkToStopSec } from '@/lib/guidance/transit-progress'
import { rankCandidates, RideObserver, vehicleVerdict, type CandidateSet, type RankedCandidate, type VehicleCandidate } from '@/lib/guidance/vehicle-switch'
import { fetchVehicleCandidates } from '@/services/guidance/vehicle-candidates.service'
import { guidanceClock } from '@/services/guidance/guidance-clock'

/** Close enough to the stop to look up what leaves it. */
const LOOKUP_WALK_SEC = 180
const WAITING_REFRESH_MS = 60_000
const RIDING_REFRESH_MS = 30_000
/** Long enough into the ride that an unanswered question has nothing left to settle. */
const GIVE_UP_AFTER_MS = 15 * 60_000

interface Watch {
  segmentIndex: number
  segment: unknown
  plannedTripId: string | undefined
  observer: RideObserver
  set: CandidateSet | null
  fetchedAt: number
  fetching: boolean
  done: boolean
}

export interface VehicleQuestion {
  segmentIndex: number
  options: RankedCandidate[]
  routeType?: number
}

/** Works out which run the rider actually boarded, retargets the ride to it, and asks when it can't tell. */
export function useVehicleSwitch() {
  const guidance = useGuidanceStore()
  const question = shallowRef<VehicleQuestion | null>(null)
  let current: Watch | null = null
  let retargeting = false
  let queued: VehicleCandidate | null = null

  function watchFor(segmentIndex: number): Watch | null {
    const route = guidance.route
    const segment = guidance.segments[segmentIndex]
    if (!route || segment?.mode !== 'transit') return null
    return {
      segmentIndex,
      segment,
      plannedTripId: segment.tripId,
      observer: new RideObserver(rideStops(route, segmentIndex, segment)),
      set: null,
      fetchedAt: 0,
      fetching: false,
      done: false,
    }
  }

  async function refresh(watched: Watch) {
    watched.fetching = true
    watched.fetchedAt = Date.now()
    try {
      const set = await fetchVehicleCandidates(guidance.segments[watched.segmentIndex])
      if (set && current === watched) watched.set = set
    } finally {
      watched.fetching = false
    }
  }

  async function retarget(watched: Watch, candidate: VehicleCandidate) {
    if (!watched.set) return
    if (retargeting) {
      queued = candidate
      return
    }
    retargeting = true
    try {
      await guidance.retargetRide(watched.segmentIndex, candidate, watched.set.known)
    } finally {
      retargeting = false
    }
    const next = queued
    queued = null
    if (next && current === watched) await retarget(watched, next)
  }

  function settle(watched: Watch, candidate: VehicleCandidate | null) {
    watched.done = true
    question.value = null
    if (candidate) void retarget(watched, candidate)
  }

  function tick() {
    const stage = guidance.transit
    const puck = guidance.progress?.puck
    const route = guidance.route
    if (!stage || !puck || !route || stage.kind === 'missed-stop') return
    if (current?.segmentIndex !== stage.segmentIndex || current.segment !== guidance.segments[stage.segmentIndex]) {
      question.value = null
      current = watchFor(stage.segmentIndex)
    }
    const watched = current
    if (!watched || watched.done) return
    const nowMs = guidanceClock.now()
    const riding = stage.kind === 'riding'
    if (puck.snapped || riding) watched.observer.update({ s: puck.s, speed: puck.speed, snapped: puck.snapped, position: puck.position, nowMs })

    const near = stage.kind !== 'to-stop' || walkToStopSec(route, stage, puck.s) < LOOKUP_WALK_SEC
    const due = Date.now() - watched.fetchedAt > (riding ? RIDING_REFRESH_MS : WAITING_REFRESH_MS)
    if (near && due && !watched.fetching) void refresh(watched)

    const boardedAt = watched.observer.boardedAtMs
    if (!riding || !watched.set || boardedAt == null) return
    if (nowMs - boardedAt > GIVE_UP_AFTER_MS) return settle(watched, null)
    const verdict = vehicleVerdict(rankCandidates(watched.set, watched.observer.evidence(), watched.plannedTripId, nowMs))
    if (verdict.kind === 'settled') return settle(watched, verdict.candidate)
    if (verdict.kind !== 'ask') return
    const [best] = verdict.options
    if (guidance.segments[watched.segmentIndex]?.tripId !== best.candidate.tripId) void retarget(watched, best.candidate)
    const asked = question.value
    const ids = (q: VehicleQuestion | null) => q?.options.map(o => o.candidate.tripId).join() ?? ''
    const next = { segmentIndex: watched.segmentIndex, options: verdict.options, routeType: best.candidate.routeType ?? guidance.segments[watched.segmentIndex]?.routeType }
    if (ids(asked) !== ids(next)) question.value = next
    if (!asked) guidance.askWhichVehicle(watched.segmentIndex)
  }

  /** The rider's answer; null is "none of these", which keeps the current guess. */
  function answer(candidate: VehicleCandidate | null) {
    if (current) settle(current, candidate)
  }

  const stop = watch(() => guidance.progress, tick)
  onScopeDispose(stop)

  return { question, answer }
}
