<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Map as MaplibreMap } from 'maplibre-gl'
import { roadLabel } from '@/lib/guidance/guidance-display'
import { puckFocal } from '@/lib/guidance/camera-framing'
import { isAboard } from '@/lib/guidance/guidance-layout'
import { toContainerRect } from '@/lib/map/map-padding'
import { boxesCrowd } from '@/lib/guidance/declutter'
import { useAppStore } from '@/stores/app.store'
import { useMapStore } from '@/stores/map.store'
import { useGuidanceStore } from '@/stores/guidance.store'
import { useGuidanceContext } from './context'

const { t } = useI18n()
const appStore = useAppStore()
const mapStore = useMapStore()
const guidance = useGuidanceStore()
const { camera, routeLine } = useGuidanceContext()

const label = computed(() => {
  const route = guidance.followed
  const puck = guidance.progress?.puck
  if (!route || !puck?.snapped || !camera.following.value || isAboard(guidance.transit)) return null
  const road = roadLabel(route, puck.s)
  if (road.kind === 'named') return { name: road.name, ref: road.ref }
  // Off any road, free roam's straight path ahead has nothing to name.
  return guidance.kind === 'free' ? null : { name: t(`guidance.roads.${road.key}`) }
})

const PUCK_CLEARANCE = 30
/** Naming the same road as the turn bubble, the pill gives way from further off. */
const CALLOUT_MARGIN = { other: 4, same: 48 }

// The puck is pinned to the camera's focal point while following, so the
// label can sit there without tracking the marker frame by frame.
const position = computed(() => {
  const map = mapStore.getMapStrategy()?.mapInstance as MaplibreMap | undefined
  const container = map?.getContainer().getBoundingClientRect()
  const visible = container ? toContainerRect(appStore.visibleMapArea, container) : appStore.visibleMapArea
  const focal = puckFocal(guidance.preferences.cameraMode, guidance.cameraTuning, visible.height)
  return {
    left: `${visible.x + visible.width / 2}px`,
    top: `${visible.y + visible.height * focal + PUCK_CLEARANCE}px`,
  }
})

const pill = useTemplateRef<HTMLElement>('pill')
const yielding = ref(false)
watch(
  () => guidance.progress,
  () => {
    const callout = routeLine.turnCalloutOnScreen()
    const box = pill.value?.getBoundingClientRect()
    if (!callout || !box || !label.value) return (yielding.value = false)
    const margin = callout.text === label.value.name ? CALLOUT_MARGIN.same : CALLOUT_MARGIN.other
    yielding.value = boxesCrowd(box, callout.box, margin)
  },
  { flush: 'post' },
)
</script>

<template>
  <div
    v-if="label"
    ref="pill"
    class="absolute -translate-x-1/2 transition-opacity duration-200"
    :class="{ 'opacity-0': yielding }"
    :style="position"
  >
    <Transition
      mode="out-in"
      enter-active-class="transition-opacity duration-300"
      enter-from-class="opacity-0"
      leave-active-class="transition-opacity duration-200"
      leave-to-class="opacity-0"
    >
      <div
        :key="label.name"
        class="nav-surface flex max-w-[70vw] items-center gap-1.5 truncate rounded-full bg-background/95 px-3.5 py-1.5 text-[15px] font-semibold shadow-lg ring-1 ring-foreground/5"
      >
        <span v-if="label.ref" class="rounded bg-muted px-1 text-xs">{{ label.ref }}</span>
        <span class="truncate">{{ label.name }}</span>
      </div>
    </Transition>
  </div>
</template>
