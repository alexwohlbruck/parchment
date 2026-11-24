import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { usePremiumNavigation } from '@/composables/usePremiumNavigation'
import { useGuidanceStore } from '@/stores/guidance.store'
import { segmentAt } from '@/lib/guidance/nav-route'
import { modeProfile } from '@/lib/guidance/mode-profiles'
import { dockRisk, pollInterval, stationOptions, watchedDock, type DockRisk, type DockSample, type StationOption } from '@/lib/guidance/dock-watch'
import {
  fetchAlternatives,
  fetchStation,
  type DockAlternative,
  type StationStatus,
} from '@/services/guidance/dock-watch.service'

/** Polls the bike share station the leg depends on and offers others when it runs short. */
export function useDockWatch() {
  const guidance = useGuidanceStore()
  const premium = usePremiumNavigation()

  const current = computed(() => {
    const route = guidance.route
    const puck = guidance.progress?.puck
    return route && puck ? segmentAt(route, puck.s)?.index ?? 0 : null
  })
  const watched = computed(() => (premium.value && current.value != null ? watchedDock(guidance.segments, current.value) : null))
  const key = computed(() => (watched.value ? `${watched.value.boundary}:${watched.value.location.lat},${watched.value.location.lng}` : null))

  const station = shallowRef<StationStatus | null>(null)
  const risk = ref<DockRisk>('ok')
  const alternatives = shallowRef<DockAlternative[]>([])
  /** Stations already switched away from, never offered again. */
  const leftBehind = new Set<string>()
  const alternative = computed(() => alternatives.value[0] ?? null)
  const options = computed<StationOption[]>(() =>
    watched.value ? stationOptions(alternatives.value, watched.value.need, guidance.progress?.puck.position ?? null) : [],
  )
  const loadingAlternatives = ref(false)
  /** Set once the station is out, so the picker opens; cleared when it does. */
  const pickRequested = ref(false)
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

  async function loadAlternatives() {
    const dock = watched.value
    if (!dock) return
    const watching = key.value
    loadingAlternatives.value = true
    try {
      const onward = guidance.segments[dock.boundary + 1]?.geometry?.at(-1) ?? null
      const found = await fetchAlternatives(dock.location, dock.need, onward)
      if (key.value === watching) alternatives.value = found.filter(a => !leftBehind.has(a.stationId))
    } finally {
      loadingAlternatives.value = false
    }
  }

  async function check(watching: string) {
    const dock = watched.value
    if (!dock) return
    const status = await fetchStation(dock.location)
    if (!status || key.value !== watching) return
    const was = risk.value
    station.value = status
    samples = [...samples, { t: Date.now(), available: dock.need === 'dock' ? status.docks : status.bikes }]
    risk.value = dockRisk(samples, Date.now() + approach().seconds * 1000)
    if (risk.value === 'ok') return
    await loadAlternatives()
    if (risk.value === 'gone' && was !== 'gone' && alternatives.value.length) pickRequested.value = true
  }

  /** Every check reschedules the next, whatever it found, so one failed or overtaken check never ends the watch. */
  async function poll(watching: string) {
    try {
      await check(watching)
    } catch {
      // Try again on the next tick.
    } finally {
      if (key.value === watching) {
        const { distance, seconds } = approach()
        timer = setTimeout(() => void poll(watching), pollInterval(distance, seconds))
      }
    }
  }

  async function pick(to: { name: string; location: { lat: number; lng: number } }): Promise<boolean> {
    const dock = watched.value
    if (!dock || switching.value) return false
    const leaving = station.value?.stationId
    switching.value = true
    try {
      if (leaving) leftBehind.add(leaving)
      return await guidance.switchDock(dock.boundary, { name: to.name, location: to.location })
    } catch {
      return false
    } finally {
      switching.value = false
    }
  }

  async function accept() {
    if (alternative.value) await pick(alternative.value)
  }

  function reset() {
    if (timer) clearTimeout(timer)
    timer = null
    samples = []
    station.value = null
    risk.value = 'ok'
    alternatives.value = []
    pickRequested.value = false
    dismissed.value = false
  }

  const stop = watch(
    key,
    next => {
      reset()
      if (next) void poll(next)
    },
    { immediate: true },
  )

  onScopeDispose(() => {
    stop()
    reset()
  })

  return {
    watched,
    station,
    risk,
    alternative,
    options,
    loadingAlternatives,
    pickRequested,
    dismissed,
    switching,
    loadAlternatives,
    pick,
    accept,
    dismiss: () => (dismissed.value = true),
  }
}
