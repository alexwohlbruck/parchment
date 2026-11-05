import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTransitClock } from '@/composables/transit/useTransitClock'
import { useDirectionsService } from '@/services/directions.service'
import { useDirectionsStore } from '@/stores/directions.store'
import { useNavigationPreferencesStore } from '@/stores/preferences/navigation-preferences.store'
import {
  adviceText,
  adviceTone,
  adviceValidUntil,
  boardingLeg,
  crossover,
  crossoverText,
  isFuturePlan,
  tightText,
  tripAdvice,
  type AdviceKind,
} from '@/lib/directions/trip-advice'
import { byRank } from '@/lib/directions/trip-display'
import type { TripOption } from '@/types/directions.types'

export interface AdviceLine {
  text: string
  tone: string
}

export interface TripAdviceLines {
  kind: AdviceKind | null
  line: AdviceLine | null
  tight: string | null
  sched: string | null
}

export interface TripCardAdvice {
  line: AdviceLine | null
  crossover: string | null
}

const ADVICE_TICK_MS = 15_000
/** A result that is already missed when it lands must not re-plan in a loop. */
const MIN_REPLAN_GAP_MS = 120_000

/** A trip's advice as display lines, under the rider's buffer and depart-at time. */
export function useTripAdvice() {
  const store = useDirectionsStore()
  const navigationPreferences = useNavigationPreferencesStore()
  const { t } = useI18n()

  function adviceFor(trip: TripOption, nowMs: number): TripAdviceLines | null {
    const leg = boardingLeg(trip.segments)
    const advice = tripAdvice(trip.departureProfile, nowMs, {
      transitBufferMinutes: navigationPreferences.transitBufferMinutes,
      future: isFuturePlan(store.departureTime, nowMs),
      boardsAtMs: leg?.departMs,
    })
    if (!advice) return null
    return {
      kind: advice.state?.kind ?? null,
      line: advice.state
        ? { text: adviceText(advice.state, t, leg?.line), tone: adviceTone(advice.state.kind) }
        : null,
      tight: advice.tight ? tightText(advice.tight, t) : null,
      sched: advice.live ? null : t('directions.advice.long.sched'),
    }
  }

  return { adviceFor }
}

/**
 * Card advice for a result list, by trip id, recomputed on a light clock. A
 * card draws its planned run, so once that run is missed or the profiles run
 * out, the search is re-planned quietly instead of describing a trip that is gone.
 */
export function useTripListAdvice(trips: () => TripOption[]) {
  const { adviceFor } = useTripAdvice()
  const { t } = useI18n()
  const directionsService = useDirectionsService()
  const now = useTransitClock(ADVICE_TICK_MS)

  const lines = computed(() => {
    const nowMs = now.value.getTime()
    return new Map(trips().map(trip => [trip.id, adviceFor(trip, nowMs)]))
  })

  const advice = computed(() => {
    const list = trips()
    const best = byRank(list)[0]
    const cross = crossover(list, now.value.getTime())
    const out: Record<string, TripCardAdvice> = {}
    for (const trip of list) {
      const tripLines = lines.value.get(trip.id)
      out[trip.id] = {
        line: tripLines?.kind === 'missed' ? null : (tripLines?.line ?? null),
        crossover: cross && trip === best ? crossoverText(cross, t) : null,
      }
    }
    return out
  })

  let replannedFor: TripOption[] | null = null
  let replannedAtMs = -Infinity
  watch(now, current => {
    const list = trips()
    const nowMs = current.getTime()
    const until = adviceValidUntil(list)
    const expired = until != null && nowMs >= until
    const missed = [...lines.value.values()].some(l => l?.kind === 'missed')
    if (!(expired || missed) || replannedFor === list) return
    if (nowMs - replannedAtMs < MIN_REPLAN_GAP_MS) return
    replannedFor = list
    replannedAtMs = nowMs
    void directionsService.replan()
  })

  return advice
}
