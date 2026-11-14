import { computed, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useDebounceFn } from '@vueuse/core'
import { ESTIMATE_MODES } from '@server/lib/directions/mode-estimates'
import { useDirectionsStore, SELECTABLE_MODES } from '@/stores/directions.store'
import { useNavigationPreferencesStore } from '@/stores/preferences/navigation-preferences.store'
import { fetchModeEstimates } from '@/services/mode-estimates.service'
import { useLatestRequest, SUPERSEDED } from '@/composables/useLatestRequest'
import {
  modesToEstimate,
  plannedSeconds,
  travelTimeFor,
  travelTimesKey,
  type TravelTime,
} from '@/lib/directions/mode-estimates'
import type { SelectedMode } from '@/types/multimodal.types'

/** Waits out a dragged marker or a run of edits before asking. */
const ESTIMATE_DEBOUNCE_MS = 400

/** How long each travel mode would take for the current stops, for the mode tabs. */
export function useModeTravelTimes() {
  const store = useDirectionsStore()
  const { waypoints, departureTime, selectedMode, trips, isLoading, plannedTimes, estimatedTimes } = storeToRefs(store)
  const { routing } = storeToRefs(useNavigationPreferencesStore())
  const estimating = useLatestRequest('failed to estimate travel times')

  const points = computed(() =>
    waypoints.value.flatMap(wp => (wp.lngLat ? [{ lat: wp.lngLat.lat, lng: wp.lngLat.lng }] : [])))

  const preferences = computed(() =>
    Object.fromEntries(ESTIMATE_MODES.map(mode => [mode, { ...routing.value.general, ...routing.value.mode[mode] }])))

  const key = computed(() =>
    points.value.length >= 2 ? travelTimesKey(points.value, departureTime.value, preferences.value) : '')

  watch(trips, planned => {
    if (planned && key.value) {
      store.recordPlannedTimes(key.value, { [selectedMode.value]: plannedSeconds(planned.trips) })
    }
  })

  async function estimate() {
    const forKey = key.value
    if (!forKey) return estimating.abort()
    const modes = modesToEstimate(selectedMode.value, plannedTimes.value.get(forKey), estimatedTimes.value.get(forKey))
    if (!modes.length) return
    const estimates = await estimating.run(signal => fetchModeEstimates({
      waypoints: points.value,
      modes,
      routingPreferences: Object.fromEntries(modes.map(mode => [mode, preferences.value[mode]])),
      ...(departureTime.value && { departureTime: departureTime.value }),
    }, signal))
    if (estimates && estimates !== SUPERSEDED) store.recordEstimatedTimes(forKey, estimates)
  }

  const estimateSoon = useDebounceFn(estimate, ESTIMATE_DEBOUNCE_MS)
  watch([key, selectedMode], () => estimateSoon(), { immediate: true })

  return computed(() => {
    const forKey = key.value
    const planned = forKey ? plannedTimes.value.get(forKey) : undefined
    const estimated = forKey ? estimatedTimes.value.get(forKey) : undefined
    return Object.fromEntries(SELECTABLE_MODES.map(mode => {
      const loading = mode === selectedMode.value
        ? isLoading.value
        : estimating.pending.value && (ESTIMATE_MODES as readonly SelectedMode[]).includes(mode)
      const time: TravelTime = forKey ? travelTimeFor(mode, planned, estimated, loading) : { state: 'unknown' }
      return [mode, time]
    })) as Partial<Record<SelectedMode, TravelTime>>
  })
}
