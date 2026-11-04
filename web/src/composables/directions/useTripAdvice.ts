import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTransitClock } from '@/composables/transit/useTransitClock'
import { useDirectionsService } from '@/services/directions.service'
import { useDirectionsStore } from '@/stores/directions.store'
import {
  DEFAULT_TRANSIT_BUFFER_MIN,
  adviceText,
  adviceTone,
  adviceValidUntil,
  boardingLeg,
  crossover,
  crossoverText,
  isFuturePlan,
  tightText,
  tripAdvice,
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
  line: AdviceLine | null
  crossover: string | null
}

const ADVICE_TICK_MS = 15_000

/** A trip's advice as display lines, under the rider's buffer and depart-at time. */
export function useTripAdvice() {
  const store = useDirectionsStore()
  const { t } = useI18n()

  function adviceFor(trip: TripOption, nowMs: number): TripAdviceLines | null {
    const leg = boardingLeg(trip.segments)
    const advice = tripAdvice(trip.departureProfile, nowMs, {
      transitBufferMinutes:
        store.modePreferences.transit?.transitBufferMinutes ?? DEFAULT_TRANSIT_BUFFER_MIN,
      future: isFuturePlan(store.departureTime, nowMs),
      boardsAtMs: leg?.departMs,
    })
    if (!advice) return null
    return {
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
 * Card advice for a result list, by trip id, recomputed on a light clock. Once
 * the clock passes the shown profiles, the search is re-planned once, quietly.
 */
export function useTripListAdvice(trips: () => TripOption[]) {
  const { adviceFor } = useTripAdvice()
  const { t } = useI18n()
  const directionsService = useDirectionsService()
  const now = useTransitClock(ADVICE_TICK_MS)

  const advice = computed(() => {
    const nowMs = now.value.getTime()
    const list = trips()
    const best = byRank(list)[0]
    const cross = crossover(list, nowMs)
    const out: Record<string, TripCardAdvice> = {}
    for (const trip of list) {
      out[trip.id] = {
        line: adviceFor(trip, nowMs)?.line ?? null,
        crossover: cross && trip === best ? crossoverText(cross, t) : null,
      }
    }
    return out
  })

  let replannedFor: TripOption[] | null = null
  watch(now, current => {
    const list = trips()
    const until = adviceValidUntil(list)
    if (until == null || current.getTime() < until || replannedFor === list) return
    replannedFor = list
    void directionsService.replan()
  })

  return advice
}
