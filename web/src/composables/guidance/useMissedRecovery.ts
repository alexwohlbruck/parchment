import { computed, ref, shallowRef, watch } from 'vue'
import { useGuidanceStore } from '@/stores/guidance.store'
import { segmentAt } from '@/lib/guidance/nav-route'
import { walkToStopSec, type TransitStage } from '@/lib/guidance/transit-progress'
import { isTransitOnly } from '@/lib/guidance/better-itinerary'
import { classifyRecovery, type MissedRide, type RecoveryPlan, type RecoverySegment } from '@/lib/guidance/missed-recovery'
import { approachReach } from '@/lib/transit/transit-reachability'
import { requestTransitItineraries } from '@/services/guidance/reroute.service'
import { guidanceClock } from '@/services/guidance/guidance-clock'
import type { TripOption } from '@/types/directions.types'

/** Plans fetched on the way to the stop still stand this long after the miss. */
const FRESH_MS = 2 * 60_000

type Plan = RecoveryPlan<TripOption>
type Boarding = Extract<TransitStage, { kind: 'to-stop' | 'wait' | 'missed-vehicle' }>
type Segments = Parameters<ReturnType<typeof useGuidanceStore>['takeItinerary']>[1]

interface Lookup {
  key: string
  missed: MissedRide
  candidates: TripOption[]
  fetchedAt: number
}

interface Retimed {
  key: string
  segmentIndex: number
  departureMs: number
  arrivalMs: number
  delayMs: number
  better: Plan | null
}

export type RecoveryView =
  | { kind: 'pending' }
  | { kind: 'retimed'; line: string; departureMs: number; arrivalMs: number; delayMs: number; better: Plan | null }
  | { kind: 'choose'; options: Plan[] }

const keyOf = (stage: Boarding) => `${stage.segmentIndex}:${stage.departureMs}`
const endOf = (segments: RecoverySegment[]) => new Date(segments.at(-1)?.endTime ?? NaN).getTime()

/**
 * Replans from the rider as soon as a boarding looks lost, and again once it is.
 * The same line's next run is taken without asking; a clearly sooner plan is offered beside it.
 */
export function useMissedRecovery() {
  const guidance = useGuidanceStore()
  const lookup = shallowRef<Lookup | null>(null)
  const retimed = shallowRef<Retimed | null>(null)
  const fetching = ref<string | null>(null)
  const failed = ref<string | null>(null)

  const atRisk = computed<{ stage: Boarding; missed: boolean } | null>(() => {
    const stage = guidance.transit
    if (stage?.kind === 'missed-vehicle') return { stage, missed: true }
    const route = guidance.route
    const puck = guidance.progress?.puck
    if (stage?.kind !== 'to-stop' || !route || !puck) return null
    const late = approachReach(stage.departureMs, guidance.clockMs, walkToStopSec(route, stage, puck.s)) === 'late'
    return late ? { stage, missed: false } : null
  })

  const recovery = computed(() => {
    const found = lookup.value
    const decided = found && classifyRecovery(found.missed, found.candidates, guidance.clockMs)
    return found && decided ? { key: found.key, decided } : null
  })

  async function fetchFor(stage: Boarding) {
    const key = keyOf(stage)
    const route = guidance.route
    const puck = guidance.progress?.puck
    const end = guidance.segments.at(-1)?.geometry?.at(-1)
    const remaining = guidance.segments.slice(stage.segmentIndex) as RecoverySegment[]
    if (!route || !puck || !end || fetching.value === key || !isTransitOnly(remaining)) return
    fetching.value = key
    try {
      const candidates = await requestTransitItineraries({ position: puck.position, destination: end, departAt: new Date(guidanceClock.now()) })
      if (guidance.route !== route) return
      const missed = lookup.value?.key === key ? lookup.value.missed : { remaining, missedMs: stage.departureMs, plannedEndMs: endOf(remaining) }
      lookup.value = { key, missed, candidates, fetchedAt: Date.now() }
    } catch {
      // The missed card's own buttons still work.
    } finally {
      if (fetching.value === key) fetching.value = null
    }
  }

  /** Takes the same line's later run, keeping any clearly sooner plan on offer beside it. */
  async function act() {
    const found = recovery.value
    const decided = found?.decided
    const stage = guidance.transit
    if (!found || !decided || decided.kind === 'choose') return
    const better = decided.kind === 'recommend-switch' ? decided.better : null
    if (retimed.value?.key === found.key) {
      retimed.value = { ...retimed.value, better }
      return
    }
    if (stage?.kind !== 'missed-vehicle' || keyOf(stage) !== found.key || guidance.rebooking) return
    const plannedEndMs = lookup.value!.missed.plannedEndMs
    if (!(await guidance.catchNextRun(decided.next.departureMs))) {
      failed.value = found.key
      return
    }
    const arrivalMs = endOf(guidance.segments as RecoverySegment[])
    retimed.value = {
      key: found.key,
      segmentIndex: stage.segmentIndex,
      departureMs: decided.next.departureMs,
      arrivalMs,
      delayMs: arrivalMs - plannedEndMs,
      better,
    }
  }

  watch(
    () => atRisk.value && `${keyOf(atRisk.value.stage)}:${atRisk.value.missed}`,
    async () => {
      const risk = atRisk.value
      if (!risk) return
      const key = keyOf(risk.stage)
      const fresh = lookup.value?.key === key && Date.now() - lookup.value.fetchedAt < FRESH_MS
      if (!risk.missed) {
        if (!fresh) await fetchFor(risk.stage)
        return
      }
      if (fresh) await act()
      await fetchFor(risk.stage)
      await act()
    },
  )

  watch(
    () => guidance.route,
    () => {
      lookup.value = null
      retimed.value = null
      failed.value = null
    },
  )

  const view = computed<RecoveryView | null>(() => {
    const stage = guidance.transit
    if (stage?.kind === 'missed-vehicle') {
      const key = keyOf(stage)
      if (failed.value === key) return null
      const decided = recovery.value?.key === key ? recovery.value.decided : null
      if (decided?.kind === 'choose') return { kind: 'choose', options: decided.options }
      if (decided || fetching.value === key || guidance.rebooking) return { kind: 'pending' }
      return null
    }
    const done = retimed.value
    if (!done || (stage?.kind !== 'to-stop' && stage?.kind !== 'wait') || stage.segmentIndex !== done.segmentIndex) return null
    const better = done.better && done.better.departureMs > guidance.clockMs ? done.better : null
    const line = guidance.segments[done.segmentIndex]?.lineName ?? ''
    return { kind: 'retimed', line, departureMs: done.departureMs, arrivalMs: done.arrivalMs, delayMs: done.delayMs, better }
  })

  /** Rides `plan` from where the rider is now. */
  function take(plan: Plan) {
    const route = guidance.route
    const puck = guidance.progress?.puck
    if (!route || !puck) return
    guidance.takeItinerary(segmentAt(route, puck.s)?.index ?? 0, plan.itinerary.segments as Segments)
  }

  return { view, take }
}
