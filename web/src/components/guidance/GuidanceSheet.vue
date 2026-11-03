<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useElementSize, useScreenSafeArea, useWindowSize } from '@vueuse/core'
import BottomSheet from '@/components/sheet/BottomSheet.vue'
import GuidanceNotices from './GuidanceNotices.vue'
import GuidanceSummary from './GuidanceSummary.vue'
import GuidancePanel from './panels/GuidancePanel.vue'
import { useGuidanceContext, type GuidancePanelKind } from './context'

/** `ceiling` is the y the open sheet stops short of, below the instruction card. */
const props = defineProps<{ ceiling: number; class?: string }>()
defineSlots<{ above?: () => unknown }>()
const { panel, openPanel, closePanel } = useGuidanceContext()

const content = ref<HTMLElement | null>(null)
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
const { height: contentHeight } = useElementSize(content, undefined, { box: 'border-box' })
const snapPoints = computed(() => {
  const room = windowHeight.value - props.ceiling - SHEET_TOP_GAP - (parseFloat(safeBottom.value) || 0)
  return ['120px', `${Math.round(Math.max(160, Math.min(contentHeight.value, room)))}px`]
})
const activeSnapPoint = computed(() => snapPoints.value[expanded.value ? 1 : 0])
</script>

<template>
  <BottomSheet
    floating
    :class="['nav-surface', props.class]"
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
      <div class="transition-opacity duration-200" :class="{ 'pointer-events-none opacity-0': expanded }">
        <slot name="above" />
        <GuidanceNotices class="pb-2 empty:hidden" />
      </div>
    </template>
    <div ref="content">
      <GuidanceSummary :expanded="expanded" @toggle="toggle" />
      <div class="border-t px-4 pb-5 pt-4">
        <GuidancePanel :kind="shown" />
      </div>
    </div>
  </BottomSheet>
</template>
