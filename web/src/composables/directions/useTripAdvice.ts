import { computed, watch } from 'vue'
import { useDocumentVisibility } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { useTransitClock } from '@/composables/transit/useTransitClock'
import { useDirectionsService } from '@/services/directions.service'
import { useDirectionsStore } from '@/stores/directions.store'
import { useNavigationPreferencesStore } from '@/stores/preferences/navigation-preferences.store'
import {
  adviceReach,
  adviceStatus,
  adviceValidUntil,
  boardsAtMs,
  crossover,
  crossoverText,
  isFuturePlan,
  tripAdvice,
  walksToFirstStop,
  type AdviceKind,
  type AdviceStatus,
  type Boarding,
  type Race,
} from '@/lib/directions/trip-advice'
import type { DepartureReachability } from '@/lib/transit/transit-reachability'
import type { TripOption } from '@/types/directions.types'

export interface TripPageAdvice {
  status: AdviceStatus | null
  /** Present while the walk is racing the train. */
  race?: Race
  /** What the board says about the planned run, so the two agree. */
  reach: DepartureReachability
  /** Whether the planned run's time is a live prediction. */
  live: boolean
}

export interface TripListAdvice {
  /** Each trip's status line, by trip id. */
  status: Record<string, AdviceStatus | null>
  /** When another mode overtakes the best transit trip; it applies to the whole list. */
  crossover: { text: string; iconMode: string } | null
}

const ADVICE_TICK_MS = 10_000
/** Background re-plans: fast while a card asks you to act, slow otherwise. */
const RESCAN_URGENT_MS = 20_000
const RESCAN_CALM_MS = 60_000
/** A missed trip re-plans straight away, but never more often than this. */
const MISSED_REPLAN_GAP_MS = 10_000
const URGENT_KINDS: ReadonlySet<AdviceKind> = new Set(['hurry', 'run', 'leave', 'missed', 'gone'])
const isMissed = (kind?: AdviceKind) => kind === 'missed' || kind === 'gone'

/** A trip's advice as display lines, under the rider's buffer and depart-at time. */
export function useTripAdvice() {
  const store = useDirectionsStore()
  const navigationPreferences = useNavigationPreferencesStore()
  const { t } = useI18n()

  function rawAdvice(trip: TripOption, nowMs: number, boarding?: Boarding) {
    return tripAdvice(trip.departureProfile, nowMs, {
      transitBufferMinutes: navigationPreferences.transitBufferMinutes,
      future: isFuturePlan(store.departureTime, nowMs),
      boardsAtMs: boardsAtMs(trip.segments),
      runFactor: walksToFirstStop(trip.segments) ? navigationPreferences.runPace : null,
      boarding,
    })
  }

  function adviceFor(trip: TripOption, nowMs: number, boarding?: Boarding): TripPageAdvice | null {
    const advice = rawAdvice(trip, nowMs, boarding)
    if (!advice) return null
    const state = advice.state
    return {
      status: adviceStatus(advice, nowMs, t, 'header'),
      ...(state && 'race' in state && { race: state.race }),
      reach: adviceReach(state),
      live: advice.live,
    }
  }

  return { adviceFor, rawAdvice }
}

/** Card hints for a result list, by trip id, keeping a leave-now search fresh as trains come and go. */
export function useTripListAdvice(trips: () => TripOption[]) {
  const { rawAdvice } = useTripAdvice()
  const { t } = useI18n()
  const store = useDirectionsStore()
  const directionsService = useDirectionsService()
  const now = useTransitClock(ADVICE_TICK_MS)
  const visibility = useDocumentVisibility()

  const raw = computed(() => {
    const nowMs = now.value.getTime()
    return new Map(trips().map(trip => [trip.id, rawAdvice(trip, nowMs)]))
  })

  const advice = computed<TripListAdvice>(() => {
    const nowMs = now.value.getTime()
    const status: Record<string, AdviceStatus | null> = {}
    for (const [id, tripAdviceNow] of raw.value) {
      status[id] = tripAdviceNow ? adviceStatus(tripAdviceNow, nowMs, t, 'card') : null
    }
    const cross = crossover(trips(), nowMs)
    return { status, crossover: cross && { text: crossoverText(cross, t), iconMode: cross.iconMode } }
  })

  /** A depart-at search is a fixed plan, and a hidden tab needs no fresh one. */
  const live = () => store.departureTime == null && visibility.value !== 'hidden'

  let lastPlanMs = Date.now()
  let lastMissedReplanMs = -Infinity
  watch(trips, () => (lastPlanMs = Date.now()))

  /** Missed trips leave the list at once and the search re-plans, unless nothing would be left. */
  watch(raw, entries => {
    if (!live()) return
    const missed = new Set([...entries].filter(([, advice]) => isMissed(advice?.state?.kind)).map(([id]) => id))
    if (!missed.size || missed.size === entries.size) return
    store.removeTrips(missed)
    const nowMs = Date.now()
    if (nowMs - lastMissedReplanMs < MISSED_REPLAN_GAP_MS) return
    lastMissedReplanMs = nowMs
    void directionsService.replan()
  })

  watch(now, current => {
    const nowMs = current.getTime()
    if (!live()) return
    const list = trips()
    const until = adviceValidUntil(list)
    const states = [...raw.value.values()].map(advice => advice?.state?.kind)
    const urgent = (until != null && nowMs >= until) || states.some(kind => kind && URGENT_KINDS.has(kind))
    if (nowMs - lastPlanMs < (urgent ? RESCAN_URGENT_MS : RESCAN_CALM_MS)) return
    lastPlanMs = nowMs
    void directionsService.replan()
  })

  return advice
}
