import { onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'
import { runsAfter, type LineRun } from '@/services/transit/transit-departures.service'
import { laterRuns, type Run } from '@/lib/transit/later-runs'

const REFRESH_MS = 60_000

/** The next runs after the one planned, so a rider who misses it can see what follows. */
export function useLaterRuns(segment: Ref<LineRun | null | undefined>, plannedMs: Ref<number | null | undefined>) {
  const runs = shallowRef<Run[]>([])
  const loading = ref(false)
  let timer: ReturnType<typeof setInterval> | null = null

  async function load() {
    const seg = segment.value
    const planned = plannedMs.value
    if (!seg || planned == null || loading.value) return
    loading.value = true
    try {
      runs.value = laterRuns(await runsAfter(seg, planned), planned)
    } finally {
      loading.value = false
    }
  }

  function stop() {
    if (timer) clearInterval(timer)
    timer = null
  }

  watch(
    [segment, plannedMs],
    () => {
      stop()
      runs.value = []
      if (!segment.value || plannedMs.value == null) return
      load()
      timer = setInterval(load, REFRESH_MS)
    },
    { immediate: true },
  )
  onScopeDispose(stop)

  return runs
}
