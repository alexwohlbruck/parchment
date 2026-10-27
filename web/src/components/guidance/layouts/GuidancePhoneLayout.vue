<script setup lang="ts">
import { computed, ref } from 'vue'
import { useElementBounding } from '@vueuse/core'
import { useAppStore } from '@/stores/app.store'
import { useGuidanceStore } from '@/stores/guidance.store'
import { useObstructingComponent } from '@/composables/sheet/useObstructingComponent'
import InstructionCard from '../InstructionCard.vue'
import HazardChip from '../HazardChip.vue'
import RoadNameLabel from '../RoadNameLabel.vue'
import SpeedPanel from '../SpeedPanel.vue'
import GuidanceMapButtons from '../GuidanceMapButtons.vue'
import GuidanceSheet from '../GuidanceSheet.vue'
import { useGuidanceContext } from '../context'

const appStore = useAppStore()
const guidance = useGuidanceStore()
defineSlots<{ dev?: (props: { placement: 'above' | 'below' }) => unknown }>()
const { panel, closePanel } = useGuidanceContext()

const root = ref<HTMLElement | null>(null)
const banner = ref<HTMLElement | null>(null)

useObstructingComponent(banner, 'guidance-banner')

const expanded = computed(() => panel.value != null)
const { bottom: bannerBottom } = useElementBounding(banner)

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
        <InstructionCard v-if="guidance.kind === 'route'" />
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

    <GuidanceSheet :ceiling="bannerBottom" />
  </div>
</template>
