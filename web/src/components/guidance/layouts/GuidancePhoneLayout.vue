<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useElementBounding, useElementSize, useScreenSafeArea, useWindowSize } from '@vueuse/core'
import { useAppStore } from '@/stores/app.store'
import { useObstructingComponent } from '@/composables/sheet/useObstructingComponent'
import BottomSheet from '@/components/sheet/BottomSheet.vue'
import InstructionCard from '../InstructionCard.vue'
import HazardChip from '../HazardChip.vue'
import RoadNameLabel from '../RoadNameLabel.vue'
import SpeedPanel from '../SpeedPanel.vue'
import GuidanceMapButtons from '../GuidanceMapButtons.vue'
import GuidanceNotices from '../GuidanceNotices.vue'
import GuidanceSummary from '../GuidanceSummary.vue'
import GuidancePanel from '../panels/GuidancePanel.vue'
import { useGuidanceContext, type GuidancePanelKind } from '../context'

const appStore = useAppStore()
defineSlots<{ dev?: (props: { placement: 'above' | 'below' }) => unknown }>()
const { panel, openPanel, closePanel } = useGuidanceContext()

const root = ref<HTMLElement | null>(null)
const banner = ref<HTMLElement | null>(null)
const content = ref<HTMLElement | null>(null)

useObstructingComponent(banner, 'guidance-banner')

const expanded = computed(() => panel.value != null)

// The panel stays as it was while the sheet closes over it, then resets to the menu.
const COLLAPSE_MS = 500
const shown = ref<GuidancePanelKind>('menu')
let resetTimer: ReturnType<typeof setTimeout> | null = null
watch(panel, next => {
  if (resetTimer) clearTimeout(resetTimer)
  resetTimer = null
  if (next) shown.value = next
  else resetTimer = setTimeout(() => (shown.value = 'menu'), COLLAPSE_MS)
})
onBeforeUnmount(() => {
  if (resetTimer) clearTimeout(resetTimer)
})

function toggle() {
  if (expanded.value) closePanel(true)
  else openPanel('menu')
}

function onSnapIndex(index: number) {
  if (index === 1 && !expanded.value) openPanel('menu')
  else if (index === 0 && expanded.value) closePanel(true)
}

// The open sheet fits its content, stopping short of the instruction card.
const SHEET_TOP_GAP = 20
const { height: windowHeight } = useWindowSize()
const { bottom: safeBottom } = useScreenSafeArea()
const { bottom: bannerBottom } = useElementBounding(banner)
const { height: contentHeight } = useElementSize(content, undefined, { box: 'border-box' })
const snapPoints = computed(() => {
  const room = windowHeight.value - bannerBottom.value - SHEET_TOP_GAP - (parseFloat(safeBottom.value) || 0)
  return ['120px', `${Math.round(Math.max(160, Math.min(contentHeight.value, room)))}px`]
})
const activeSnapPoint = computed(() => snapPoints.value[expanded.value ? 1 : 0])

const sideInset = computed(() => {
  const height = root.value?.clientHeight ?? window.innerHeight
  const area = appStore.visibleMapArea
  return { bottom: `${Math.max(0, height - (area.y + area.height)) + 12}px` }
})
</script>

<template>
  <div ref="root" class="pointer-events-none absolute inset-0 z-30 select-none">
    <Transition
      enter-active-class="transition-opacity duration-300"
      enter-from-class="opacity-0"
      leave-active-class="transition-opacity duration-200"
      leave-to-class="opacity-0"
    >
      <div v-if="expanded" class="pointer-events-auto absolute inset-0 bg-black/30" @click="closePanel(true)" />
    </Transition>

    <Transition appear enter-active-class="transition-opacity duration-300" enter-from-class="opacity-0">
      <div ref="banner" class="absolute inset-x-0 top-0 px-2 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
        <InstructionCard />
        <div class="absolute inset-x-0 top-full flex justify-center pt-2">
          <HazardChip />
        </div>
      </div>
    </Transition>

    <RoadNameLabel />

    <div class="absolute left-3 transition-[bottom] duration-200" :style="sideInset">
      <SpeedPanel />
    </div>

    <div class="absolute right-3 flex flex-col items-end gap-2.5 transition-[bottom] duration-200" :style="sideInset">
      <slot name="dev" placement="above" />
      <GuidanceMapButtons class="nav-surface" />
    </div>

    <BottomSheet
      floating
      class="nav-surface"
      :custom-snap-points="snapPoints"
      :active-snap-point="activeSnapPoint"
      :dismissable="false"
      dynamic-peek
      adjust-map-padding
      obstructing-key="guidance-dock"
      :max-obstructing-snap-index="0"
      @update:active-snap-point-index="onSnapIndex"
    >
      <template #above>
        <GuidanceNotices class="transition-opacity duration-200" :class="{ 'pointer-events-none opacity-0': expanded }" />
      </template>
      <div ref="content">
        <GuidanceSummary :expanded="expanded" @toggle="toggle" />
        <div class="border-t px-4 pb-5 pt-4">
          <GuidancePanel :kind="shown" />
        </div>
      </div>
    </BottomSheet>
  </div>
</template>
