import { computed, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { storeToRefs } from 'pinia'
import { useDebounceFn } from '@vueuse/core'
import { ESTIMATE_MODES, type EstimateMode } from '@server/lib/directions/mode-estimates'
import { useDirectionsStore } from '@/stores/directions.store'
import { useGeolocationService } from '@/services/geolocation.service'
import { fetchModeEstimates } from '@/services/mode-estimates.service'
import { useLatestRequest, SUPERSEDED } from '@/composables/useLatestRequest'
import { useEstimatePreferences } from '@/composables/directions/useEstimatePreferences'
import { usePremiumNavigation } from '@/composables/usePremiumNavigation'
import { fastestTravelTime, travelTimeFor, travelTimesKey, type TravelTime } from '@/lib/directions/mode-estimates'

const ESTIMATE_DEBOUNCE_MS = 400

function isEstimateMode(mode: string): mode is EstimateMode {
  return (ESTIMATE_MODES as readonly string[]).includes(mode)
}

function modesFor(mode: string): EstimateMode[] {
  if (mode === 'multi') return [...ESTIMATE_MODES]
  return isEstimateMode(mode) ? [mode] : []
}

/**
 * How long the last-used travel mode takes from the user's location to
 * `destination`; for a mixed trip, the quickest single mode. Shares the directions tabs' cache, so opening directions
 * afterwards shows the same time without asking again.
 */
export function usePlaceTravelTime(destination: MaybeRefOrGetter<{ lat: number; lng: number } | null | undefined>) {
  const store = useDirectionsStore()
  const { selectedMode, plannedTimes, estimatedTimes } = storeToRefs(store)
  const geo = useGeolocationService()
  const preferences = useEstimatePreferences()
  const estimating = useLatestRequest('failed to estimate travel time')
  const premium = usePremiumNavigation()

  const points = computed(() => {
    const from = geo.lngLat.value
    const to = toValue(destination)
    return from && to ? [{ lat: from.lat, lng: from.lng }, { lat: to.lat, lng: to.lng }] : null
  })

  const key = computed(() =>
    premium.value && points.value && modesFor(selectedMode.value).length
      ? travelTimesKey(points.value, null, preferences.value)
      : '')

  async function estimate() {
    const forKey = key.value
    if (!forKey || !points.value) return estimating.abort()
    const known = { ...estimatedTimes.value.get(forKey), ...plannedTimes.value.get(forKey) }
    const modes = modesFor(selectedMode.value).filter(mode => !(mode in known))
    if (!modes.length) return
    const estimates = await estimating.run(signal => fetchModeEstimates({
      waypoints: points.value!,
      modes,
      routingPreferences: Object.fromEntries(modes.map(mode => [mode, preferences.value[mode]])),
    }, signal))
    if (estimates && estimates !== SUPERSEDED) store.recordEstimatedTimes(forKey, estimates)
  }

  const estimateSoon = useDebounceFn(estimate, ESTIMATE_DEBOUNCE_MS)
  watch(key, () => estimateSoon(), { immediate: true })

  const time = computed<TravelTime>(() => {
    const forKey = key.value
    if (!forKey) return { state: 'unknown' }
    const planned = plannedTimes.value.get(forKey)
    const estimated = estimatedTimes.value.get(forKey)
    const mode = selectedMode.value
    if (mode === 'multi' && !(planned && mode in planned)) {
      return fastestTravelTime(planned, estimated, estimating.pending.value)
    }
    return travelTimeFor(mode, planned, estimated, estimating.pending.value)
  })

  return { mode: selectedMode, time }
}
