import { computed, watch } from 'vue'
import { useDocumentVisibility } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { useTransitClock } from '@/composables/transit/useTransitClock'
import { useDirectionsService } from '@/services/directions.service'
import { useDirectionsStore } from '@/stores/directions.store'
import { useNavigationPreferencesStore } from '@/stores/preferences/navigation-preferences.store'
import {
  adviceText,
  adviceTone,
  adviceValidUntil,
  cardHint,
  boardingLeg,
  crossover,
  crossoverText,
  isFuturePlan,
  tightText,
  tripAdvice,
  walksToFirstStop,
  type AdviceKind,
  type CardHint,
} from '@/lib/directions/trip-advice'
import { byRank } from '@/lib/directions/trip-display'
import type { TripOption } from '@/types/directions.types'

export interface AdviceLine {
  text: string
  tone: string
}

export interface TripAdviceLines {
  line: AdviceLine | null
  tight: string | null
  sched: string | null
}

export interface TripCardAdvice {
  hint: CardHint | null
  crossover: string | null
}

const ADVICE_TICK_MS = 10_000
/** Background re-plans: fast while a card asks you to act, slow otherwise. */
const RESCAN_URGENT_MS = 20_000
const RESCAN_CALM_MS = 60_000
/** A missed trip re-plans straight away, but never more often than this. */
const MISSED_REPLAN_GAP_MS = 10_000
const URGENT_KINDS: ReadonlySet<AdviceKind> = new Set(['hurry', 'run', 'leave', 'missed'])

/** A trip's advice as display lines, under the rider's buffer and depart-at time. */
export function useTripAdvice() {
  const store = useDirectionsStore()
  const navigationPreferences = useNavigationPreferencesStore()
  const { t } = useI18n()

  function rawAdvice(trip: TripOption, nowMs: number) {
    const leg = boardingLeg(trip.segments)
    const advice = tripAdvice(trip.departureProfile, nowMs, {
      transitBufferMinutes: navigationPreferences.transitBufferMinutes,
      future: isFuturePlan(store.departureTime, nowMs),
      boardsAtMs: leg?.departMs,
      runFactor: walksToFirstStop(trip.segments) ? navigationPreferences.runPace : null,
    })
    return advice && { advice, line: leg?.line }
  }

  function adviceFor(trip: TripOption, nowMs: number): TripAdviceLines | null {
    const raw = rawAdvice(trip, nowMs)
    if (!raw) return null
    const { advice, line } = raw
    return {
      line: advice.state
        ? { text: adviceText(advice.state, t, line), tone: adviceTone(advice.state.kind) }
        : null,
      tight: advice.tight ? tightText(advice.tight, t) : null,
      sched: advice.live ? null : t('directions.advice.long.sched'),
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

  const advice = computed(() => {
    const list = trips()
    const best = byRank(list)[0]
    const cross = crossover(list, now.value.getTime())
    const out: Record<string, TripCardAdvice> = {}
    for (const trip of list) {
      const entry = raw.value.get(trip.id)
      out[trip.id] = {
        hint: entry ? cardHint(entry.advice, t, entry.line) : null,
        crossover: cross && trip === best ? crossoverText(cross, t) : null,
      }
    }
    return out
  })

  /** A depart-at search is a fixed plan, and a hidden tab needs no fresh one. */
  const live = () => store.departureTime == null && visibility.value !== 'hidden'

  let lastPlanMs = Date.now()
  let lastMissedReplanMs = -Infinity
  watch(trips, () => (lastPlanMs = Date.now()))

  /** Missed trips leave the list at once and the search re-plans, unless nothing would be left. */
  watch(raw, entries => {
    if (!live()) return
    const missed = new Set([...entries].filter(([, entry]) => entry?.advice.state?.kind === 'missed').map(([id]) => id))
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
    const states = [...raw.value.values()].map(entry => entry?.advice.state?.kind)
    const urgent = (until != null && nowMs >= until) || states.some(kind => kind && URGENT_KINDS.has(kind))
    if (nowMs - lastPlanMs < (urgent ? RESCAN_URGENT_MS : RESCAN_CALM_MS)) return
    lastPlanMs = nowMs
    void directionsService.replan()
  })

  return advice
}
