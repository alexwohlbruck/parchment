import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useLayersStore } from '@/stores/layers.store'
import { useLayerAppearanceStore } from '@/stores/layer-appearance.store'
import { setMapTime } from '@/services/map/map-time.service'
import { dateAtDaySlot, minutesOfDay, weekdayIndex } from '@/lib/map-time/map-time'
import { activeTemporalLayerIds } from '@/lib/map-time/temporal-layers'

/** The acts masks and the terminator both move slower than this; anything faster is wasted redrawing. */
const TICK_MS = 60_000

/**
 * The time every temporal layer draws. Session-only on purpose: a fixed time
 * restored on reload would quietly show last Tuesday's map.
 */
export const useMapTimeStore = defineStore('map-time', () => {
  const layersStore = useLayersStore()
  const appearanceStore = useLayerAppearanceStore()

  const activeLayerIds = computed(() =>
    activeTemporalLayerIds(
      id => layersStore.allLayerGroups.some(g => g.id === id && g.visible),
      id => appearanceStore.appearanceOf(id)?.id,
    ),
  )
  const active = computed(() => activeLayerIds.value.length > 0)

  // `now` also anchors a fixed time's calendar week.
  const mode = ref<'live' | 'fixed'>('live')
  const now = ref(new Date())
  const fixedDay = ref(0)
  const fixedMinutes = ref(0)

  const time = computed(() =>
    mode.value === 'live' ? now.value : dateAtDaySlot(fixedDay.value, fixedMinutes.value, now.value),
  )
  const isLive = computed(() => mode.value === 'live')
  const displayDay = computed(() => weekdayIndex(time.value))
  const displayMinutes = computed(() => minutesOfDay(time.value))

  function setFixedTime(day: number, minutes: number) {
    mode.value = 'fixed'
    fixedDay.value = day
    fixedMinutes.value = minutes
  }

  function goLive() {
    now.value = new Date()
    mode.value = 'live'
  }

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

  watch(
    [isLive, time],
    ([live, t]) => setMapTime(live ? null : t),
    { immediate: true },
  )

  return {
    activeLayerIds,
    active,
    time,
    isLive,
    displayDay,
    displayMinutes,
    setFixedTime,
    goLive,
  }
})
