import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'
import { useGuidanceStore } from '@/stores/guidance.store'
import { useNavigationPreferencesStore } from '@/stores/preferences/navigation-preferences.store'
import { rideStops } from '@/lib/guidance/transit-progress'
import { runChoices } from '@/lib/guidance/run-choices'
import type { CandidateSet } from '@/lib/guidance/vehicle-switch'
import { fetchVehicleCandidates } from '@/services/guidance/vehicle-candidates.service'
import { guidanceClock } from '@/services/guidance/guidance-clock'

const REFRESH_MS = 30_000
/** How far ahead the rider may look for a later run. */
const AHEAD_MS = 60 * 60_000

/**
 * The runs the rider could take on ride `segmentIndex` instead of the booked one.
 * Fetched as soon as the ride is pickable and kept between openings; refreshed only while `open`.
 */
export function useRunChoices(segmentIndex: Ref<number | null>, walkSec: Ref<number>, open: Ref<boolean>) {
  const guidance = useGuidanceStore()
  const navigationPreferences = useNavigationPreferencesStore()
  const set = shallowRef<CandidateSet | null>(null)
  const loading = ref(false)
  let fetchedAt = 0
  let latest = 0
  let timer: ReturnType<typeof setInterval> | null = null

  async function load() {
    const index = segmentIndex.value
    const segment = index != null ? guidance.segments[index] : null
    if (!segment) return
    const request = ++latest
    loading.value = true
    fetchedAt = Date.now()
    try {
      const now = guidanceClock.now()
      const fresh = await fetchVehicleCandidates(segment, now, now + AHEAD_MS)
      if (request === latest && fresh) set.value = fresh
    } finally {
      if (request === latest) loading.value = false
    }
  }

  function stopRefreshing() {
    if (timer) clearInterval(timer)
    timer = null
  }

  const ride = () => (segmentIndex.value != null ? guidance.segments[segmentIndex.value] : null)
  watch(
    [segmentIndex, ride],
    ([index]) => {
      set.value = null
      fetchedAt = 0
      if (index != null) void load()
    },
    { immediate: true },
  )

  watch(open, isOpen => {
    stopRefreshing()
    if (!isOpen || segmentIndex.value == null) return
    if (Date.now() - fetchedAt > REFRESH_MS) void load()
    timer = setInterval(() => void load(), REFRESH_MS)
  })
  onScopeDispose(stopRefreshing)

  const alightStop = computed(() => {
    const index = segmentIndex.value
    const segment = ride()
    return guidance.route && segment && index != null ? rideStops(guidance.route, index, segment).at(-1)?.key ?? null : null
  })

  const choices = computed(() => {
    const segment = ride()
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
