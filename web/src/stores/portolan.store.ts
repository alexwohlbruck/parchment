import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useLayersStore } from '@/stores/layers.store'
import type { MapStrategy } from '@/components/map/map-providers/map.strategy'
import { usePortolanTransitService } from '@/services/layers/features/portolan/portolan-transit.service'
import {
  CLASS_GROUP_ROW_ID_PREFIX,
  TRANSIT_CLASS_GROUPS,
  TRANSIT_GROUP_ID,
  type TransitClassGroup,
  classVisibilityFor,
  dateAtDaySlot,
  minutesOfDay,
  portolanDay,
} from '@/services/layers/features/portolan/portolan-ui'

/** Once per minute, the useTransitClock cadence — the acts masks resolve
 *  to the hour, so anything faster is wasted refiltering. */
const TICK_MS = 60_000

/**
 * UI state for the portolan transit feature: the Transit group master
 * switch drives init/teardown, the four class toggles drive
 * setClassVisibility, and the service-time control drives setServiceTime.
 *
 * Class toggle state persists in the layers store's localStorage
 * visibility override map (same map every layer row rides), keyed by
 * synthetic `portolan:class:*` ids. The service-time control is
 * deliberately NOT persisted: a stale fixed time across reloads would
 * quietly show last Tuesday's network, so every session opens live.
 */
export const usePortolanTransitStore = defineStore('portolan-transit', () => {
  const layersStore = useLayersStore()
  const portolanService = usePortolanTransitService()

  let mapStrategy: MapStrategy | undefined

  // ── enablement ───────────────────────────────────────────────────────
  // The group switch is the product toggle; the dev flag is a session
  // constant OR'd in (documented in portolan-transit.service).
  const devFlag = (() => {
    try {
      return localStorage.getItem('parchment.portolan-transit') === '1'
    } catch {
      return false
    }
  })()

  const groupVisible = computed(() =>
    layersStore.allLayerGroups.some(g => g.id === TRANSIT_GROUP_ID && g.visible),
  )
  const active = computed(() => devFlag || groupVisible.value)

  // ── class toggles (Rail / Bus / Ferry / Other) ───────────────────────
  const classGroups = computed<Record<TransitClassGroup, boolean>>(() => {
    const out = {} as Record<TransitClassGroup, boolean>
    for (const g of TRANSIT_CLASS_GROUPS) {
      out[g] = layersStore.getLayerVisibilityOverride(CLASS_GROUP_ROW_ID_PREFIX + g) ?? true
    }
    return out
  })

  function setClassGroupVisible(group: TransitClassGroup, visible: boolean) {
    layersStore.updateLayerVisibility(CLASS_GROUP_ROW_ID_PREFIX + group, visible)
  }

  // ── service time ─────────────────────────────────────────────────────
  // Live mode tracks the wall clock (ticking); touching the slider or the
  // day control detaches into fixed mode. `now` also anchors the fixed
  // date's calendar week — stale there is fine, only weekday+hour matter.
  const mode = ref<'live' | 'fixed'>('live')
  const now = ref(new Date())
  const fixedDay = ref(0)
  const fixedMinutes = ref(0)

  const serviceDate = computed(() =>
    mode.value === 'live'
      ? now.value
      : dateAtDaySlot(fixedDay.value, fixedMinutes.value, now.value),
  )

  /** What the control renders — live mode mirrors the clock. */
  const displayDay = computed(() => portolanDay(serviceDate.value))
  const displayMinutes = computed(() => minutesOfDay(serviceDate.value))
  const isLive = computed(() => mode.value === 'live')

  function setFixedTime(day: number, minutes: number) {
    mode.value = 'fixed'
    fixedDay.value = day
    fixedMinutes.value = minutes
  }

  function goLive() {
    now.value = new Date()
    mode.value = 'live'
  }

  // Tick only while the tick means something: feature on AND tracking now.
  let tickId: ReturnType<typeof setInterval> | null = null
  watch(
    [active, mode],
    ([on, m]) => {
      if (on && m === 'live') {
        if (!tickId) tickId = setInterval(() => (now.value = new Date()), TICK_MS)
      } else if (tickId) {
        clearInterval(tickId)
        tickId = null
      }
    },
    { immediate: true },
  )

  // ── renderer wiring ──────────────────────────────────────────────────

  function applyFilters() {
    portolanService.setServiceTime(serviceDate.value)
    portolanService.setClassVisibility(classVisibilityFor(classGroups.value))
  }

  watch(active, on => {
    if (on) {
      portolanService.initializePortolanTransit(mapStrategy)
      applyFilters()
    } else {
      portolanService.teardownPortolanTransit()
    }
    // The basemap's OSM stops stand down while the feed's own stops are drawn,
    // or every station gets two near-duplicate markers a few metres apart.
    mapStrategy?.setBasemapTransitPoisVisible(!on)
  })

  watch(serviceDate, d => {
    if (active.value) portolanService.setServiceTime(d)
  })

  watch(classGroups, g => {
    if (active.value) portolanService.setClassVisibility(classVisibilityFor(g))
  })

  /** Called from map.service on every style.load (setStyle drops all
   *  portolan sources/layers; the service re-adds idempotently). */
  function handleStyleLoad(strategy: MapStrategy | undefined) {
    mapStrategy = strategy
    // A style swap rebuilds every layer with its original filter, so this has
    // to be reapplied whether the group is on or off.
    strategy?.setBasemapTransitPoisVisible(!active.value)
    if (!active.value) return
    portolanService.initializePortolanTransit(strategy)
    applyFilters()
  }

  return {
    active,
    groupVisible,
    classGroups,
    setClassGroupVisible,
    isLive,
    displayDay,
    displayMinutes,
    serviceDate,
    setFixedTime,
    goLive,
    handleStyleLoad,
  }
})
