import { computed, type Ref } from 'vue'
import { useTimestamp } from '@vueuse/core'
import type { TripOption } from '@/types/directions.types'
import { useGeolocationService } from '@/services/geolocation.service'
import { legSegments } from '@/stores/guidance.store'
import { startEligibility, type PositionFix } from '@/lib/guidance/start-eligibility'

const STALENESS_TICK_MS = 15_000

/** Whether the leg the Start button begins can be navigated from here, or only previewed. */
export function useStartEligibility(trip: Ref<TripOption | null>, leg: Ref<number | null>) {
  const geolocation = useGeolocationService()
  const now = useTimestamp({ interval: STALENESS_TICK_MS })
  const segments = computed(() => (trip.value && leg.value != null ? legSegments(trip.value, leg.value) : []))
  const fix = computed<PositionFix | null>(() => {
    const position = geolocation.lngLat.value
    const accuracy = geolocation.accuracy.value
    if (!position || accuracy == null) return null
    return { position, accuracy, at: geolocation.locatedAt.value ?? 0 }
  })
  return computed(() => startEligibility(segments.value, fix.value, now.value))
}
