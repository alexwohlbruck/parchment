import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'
import { useGuidanceStore } from '@/stores/guidance.store'
import { useNavigationPreferencesStore } from '@/stores/preferences/navigation-preferences.store'
import { rideStops } from '@/lib/guidance/transit-progress'
import { runChoices } from '@/lib/guidance/run-choices'
import type { CandidateSet } from '@/lib/guidance/vehicle-switch'
import { fetchVehicleCandidates } from '@/services/guidance/vehicle-candidates.service'
import { guidanceClock } from '@/services/guidance/guidance-clock'

const REFRESH_MS = 30_000

/** The runs the rider could take on ride `segmentIndex` instead of the booked one, kept fresh while asked for. */
export function useRunChoices(segmentIndex: Ref<number | null>, walkSec: Ref<number>) {
  const guidance = useGuidanceStore()
  const navigationPreferences = useNavigationPreferencesStore()
  const set = shallowRef<CandidateSet | null>(null)
  const loading = ref(false)
  let timer: ReturnType<typeof setInterval> | null = null

  async function load(index: number) {
    const segment = guidance.segments[index]
    if (!segment) return
    loading.value = true
    try {
      const fresh = await fetchVehicleCandidates(segment, guidanceClock.now())
      if (segmentIndex.value === index) set.value = fresh
    } finally {
      loading.value = false
    }
  }

  function stop() {
    if (timer) clearInterval(timer)
    timer = null
  }

  watch(
    segmentIndex,
    index => {
      stop()
      set.value = null
      if (index == null) return
      void load(index)
      timer = setInterval(() => void load(index), REFRESH_MS)
    },
    { immediate: true },
  )
  onScopeDispose(stop)

  const alightStop = computed(() => {
    const index = segmentIndex.value
    const segment = index != null ? guidance.segments[index] : null
    return guidance.route && segment ? rideStops(guidance.route, index!, segment).at(-1)?.key ?? null : null
  })

  const choices = computed(() => {
    const index = segmentIndex.value
    const segment = index != null ? guidance.segments[index] : null
    if (!set.value || !segment) return []
    return runChoices({
      set: set.value,
      bookedTripId: segment.tripId,
      bookedMs: new Date(segment.startTime ?? 0).getTime(),
      alightStop: alightStop.value,
      nowMs: guidance.clockMs,
      walkSec: walkSec.value,
      runFactor: navigationPreferences.runPace,
    })
  })

  return { choices, known: computed(() => set.value?.known ?? []), loading }
}
