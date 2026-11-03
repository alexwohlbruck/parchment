import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { useGuidanceStore } from '@/stores/guidance.store'
import { useAuthService } from '@/services/auth.service'
import { PermissionId } from '@/types/auth.types'
import { segmentAt } from '@/lib/guidance/nav-route'
import { modeProfile } from '@/lib/guidance/mode-profiles'
import { dockRisk, pollInterval, watchedDock, type DockRisk, type DockSample } from '@/lib/guidance/dock-watch'
import {
  fetchAlternatives,
  fetchStation,
  type DockAlternative,
  type StationStatus,
} from '@/services/guidance/dock-watch.service'

/** Polls the bike share station the leg depends on and offers a better one when it runs short. */
export function useDockWatch() {
  const guidance = useGuidanceStore()
  const premium = computed(() => useAuthService().hasPermission(PermissionId.PREMIUM_NAVIGATION))

  const current = computed(() => {
    const route = guidance.route
    const puck = guidance.progress?.puck
    return route && puck ? segmentAt(route, puck.s)?.index ?? 0 : null
  })
  const watched = computed(() => (premium.value && current.value != null ? watchedDock(guidance.segments, current.value) : null))
  const key = computed(() => (watched.value ? `${watched.value.boundary}:${watched.value.location.lat},${watched.value.location.lng}` : null))

  const station = shallowRef<StationStatus | null>(null)
  const risk = ref<DockRisk>('ok')
  const alternative = shallowRef<DockAlternative | null>(null)
  const dismissed = ref(false)
  const switching = ref(false)
  let samples: DockSample[] = []
  let timer: ReturnType<typeof setTimeout> | null = null

  /** Metres and seconds to the watched station. */
  function approach() {
    const route = guidance.route
    const puck = guidance.progress?.puck
    const dock = watched.value
    if (!route || !puck || !dock) return { distance: Infinity, seconds: Infinity }
    const span = route.segments[dock.boundary]
    const distance = Math.max(0, (span?.endDistance ?? puck.s) - puck.s)
    return { distance, seconds: distance / modeProfile(span?.mode ?? 'walking').baseSpeed }
  }

  async function poll() {
    const dock = watched.value
    if (!dock) return
    const status = await fetchStation(dock.location)
    if (dock !== watched.value) return
    const { distance, seconds } = approach()
    if (status) {
      station.value = status
      samples = [...samples, { t: Date.now(), available: dock.need === 'dock' ? status.docks : status.bikes }]
      risk.value = dockRisk(samples, Date.now() + seconds * 1000)
      if (risk.value !== 'ok' && !alternative.value) {
        const onward = guidance.segments[dock.boundary + 1]?.geometry?.at(-1) ?? null
        alternative.value = (await fetchAlternatives(dock.location, dock.need, onward))[0] ?? null
      }
      if (risk.value === 'gone' && guidance.preferences.autoSwitchDocks) await accept()
    }
    timer = setTimeout(poll, pollInterval(distance, seconds))
  }

  async function accept() {
    const dock = watched.value
    const to = alternative.value
    if (!dock || !to || switching.value) return
    switching.value = true
    try {
      await guidance.switchDock(dock.boundary, { name: to.name, location: to.location })
    } finally {
      switching.value = false
    }
  }

  function dismiss() {
    dismissed.value = true
  }

  function reset() {
    if (timer) clearTimeout(timer)
    timer = null
    samples = []
    station.value = null
    risk.value = 'ok'
    alternative.value = null
    dismissed.value = false
  }

  const stop = watch(
    key,
    next => {
      reset()
      if (next) void poll()
    },
    { immediate: true },
  )

  onScopeDispose(() => {
    stop()
    reset()
  })

  return { watched, station, risk, alternative, dismissed, switching, accept, dismiss }
}
