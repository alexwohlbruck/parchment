<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Map as MaplibreMap } from 'maplibre-gl'
import { roadLabel } from '@/lib/guidance/guidance-display'
import { isAboard } from '@/lib/guidance/guidance-layout'
import { toContainerRect } from '@/lib/map/map-padding'
import { useAppStore } from '@/stores/app.store'
import { useMapStore } from '@/stores/map.store'
import { useGuidanceStore } from '@/stores/guidance.store'
import { useGuidanceContext } from './context'

const { t } = useI18n()
const appStore = useAppStore()
const mapStore = useMapStore()
const guidance = useGuidanceStore()
const { camera } = useGuidanceContext()

const label = computed(() => {
  const route = guidance.route
  const puck = guidance.progress?.puck
  if (!route || !puck?.snapped || !camera.following.value || isAboard(guidance.transit)) return null
  const road = roadLabel(route, puck.s)
  return road.kind === 'named' ? { name: road.name, ref: road.ref } : { name: t(`guidance.roads.${road.key}`) }
})

const PUCK_CLEARANCE = 30

// The puck is pinned to the camera's focal point while following, so the
// label can sit there without tracking the marker frame by frame.
const position = computed(() => {
  const map = mapStore.getMapStrategy()?.mapInstance as MaplibreMap | undefined
  const container = map?.getContainer().getBoundingClientRect()
  const visible = container ? toContainerRect(appStore.visibleMapArea, container) : appStore.visibleMapArea
  const focal = guidance.preferences.cameraMode === 'north-up' ? 0.5 : guidance.cameraTuning.focal
  return {
    left: `${visible.x + visible.width / 2}px`,
    top: `${visible.y + visible.height * focal + PUCK_CLEARANCE}px`,
  }
})
</script>

<template>
  <div v-if="label" class="absolute -translate-x-1/2" :style="position">
    <Transition
      mode="out-in"
      enter-active-class="transition-opacity duration-300"
      enter-from-class="opacity-0"
      leave-active-class="transition-opacity duration-200"
      leave-to-class="opacity-0"
    >
      <div
        :key="label.name"
        class="nav-surface dark flex max-w-[70vw] items-center gap-1.5 truncate rounded-full bg-background/95 px-3.5 py-1.5 text-[15px] font-semibold shadow-lg"
      >
        <span v-if="label.ref" class="rounded bg-muted px-1 text-xs">{{ label.ref }}</span>
        <span class="truncate">{{ label.name }}</span>
      </div>
    </Transition>
  </div>
</template>
