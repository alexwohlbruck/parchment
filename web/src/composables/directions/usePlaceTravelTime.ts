import { computed, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { storeToRefs } from 'pinia'
import { useDebounceFn } from '@vueuse/core'
import { ESTIMATE_MODES, type EstimateMode } from '@server/lib/directions/mode-estimates'
import { useDirectionsStore } from '@/stores/directions.store'
import { useGeolocationService } from '@/services/geolocation.service'
import { fetchModeEstimates } from '@/services/mode-estimates.service'
import { useLatestRequest, SUPERSEDED } from '@/composables/useLatestRequest'
import { useEstimatePreferences } from '@/composables/directions/useEstimatePreferences'
import { travelTimeFor, travelTimesKey, type TravelTime } from '@/lib/directions/mode-estimates'

const ESTIMATE_DEBOUNCE_MS = 400

function isEstimateMode(mode: string): mode is EstimateMode {
  return (ESTIMATE_MODES as readonly string[]).includes(mode)
}

/**
 * How long the last-used travel mode takes from the user's location to
 * `destination`. Shares the directions tabs' cache, so opening directions
 * afterwards shows the same time without asking again.
 */
export function usePlaceTravelTime(destination: MaybeRefOrGetter<{ lat: number; lng: number } | null | undefined>) {
  const store = useDirectionsStore()
  const { selectedMode, plannedTimes, estimatedTimes } = storeToRefs(store)
  const geo = useGeolocationService()
  const preferences = useEstimatePreferences()
  const estimating = useLatestRequest('failed to estimate travel time')

  const points = computed(() => {
    const from = geo.lngLat.value
    const to = toValue(destination)
    return from && to ? [{ lat: from.lat, lng: from.lng }, { lat: to.lat, lng: to.lng }] : null
  })

  const key = computed(() =>
    points.value && isEstimateMode(selectedMode.value)
      ? travelTimesKey(points.value, null, preferences.value)
      : '')

  async function estimate() {
    const forKey = key.value
    const mode = selectedMode.value
    if (!forKey || !points.value || !isEstimateMode(mode)) return estimating.abort()
    const known = { ...estimatedTimes.value.get(forKey), ...plannedTimes.value.get(forKey) }
    if (mode in known) return
    const estimates = await estimating.run(signal => fetchModeEstimates({
      waypoints: points.value!,
      modes: [mode],
      routingPreferences: { [mode]: preferences.value[mode] },
    }, signal))
    if (estimates && estimates !== SUPERSEDED) store.recordEstimatedTimes(forKey, estimates)
  }

  const estimateSoon = useDebounceFn(estimate, ESTIMATE_DEBOUNCE_MS)
  watch(key, () => estimateSoon(), { immediate: true })

  const time = computed<TravelTime>(() => {
    const forKey = key.value
    if (!forKey) return { state: 'unknown' }
    return travelTimeFor(
      selectedMode.value,
      plannedTimes.value.get(forKey),
      estimatedTimes.value.get(forKey),
      estimating.pending.value,
    )
  })

  return { mode: selectedMode, time }
}
