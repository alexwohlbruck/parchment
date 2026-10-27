<script setup lang="ts">
import { computed, ref } from 'vue'
import { useElementBounding, useWindowSize } from '@vueuse/core'
import { useGuidanceStore } from '@/stores/guidance.store'
import { useObstructingComponent } from '@/composables/sheet/useObstructingComponent'
import InstructionCard from '../InstructionCard.vue'
import HazardChip from '../HazardChip.vue'
import RoadNameLabel from '../RoadNameLabel.vue'
import SpeedPanel from '../SpeedPanel.vue'
import GuidanceMapButtons from '../GuidanceMapButtons.vue'
import GuidanceSheet from '../GuidanceSheet.vue'

defineSlots<{ dev?: (props: { placement: 'above' | 'below' }) => unknown }>()
const guidance = useGuidanceStore()

const root = ref<HTMLElement | null>(null)
const column = ref<HTMLElement | null>(null)
const banner = ref<HTMLElement | null>(null)
// Measured off the root, which resizes as the rail leaves; the column itself only moves.
useObstructingComponent(root, 'guidance-column', undefined, undefined, rect => ({
  ...rect,
  width: Math.round((column.value?.getBoundingClientRect().right ?? rect.x) - rect.x),
}))
const { bottom: bannerBottom } = useElementBounding(banner)

// Landscape phones get the column without the arm's-length sizing.
const { height } = useWindowSize()
const roomy = computed(() => height.value >= 600)
</script>

<template>
  <div ref="root" class="pointer-events-none absolute inset-0 z-30 select-none">
    <div
      ref="column"
      class="absolute inset-y-0 left-0 w-[min(26rem,44vw)] pl-[calc(env(safe-area-inset-left)+1rem)] pt-[calc(env(safe-area-inset-top)+1rem)]"
    >
      <div class="absolute left-full top-[calc(env(safe-area-inset-top)+1rem)] z-10 ml-3">
        <slot name="dev" placement="below" />
      </div>
      <div ref="banner" class="flex flex-col gap-3">
        <Transition appear enter-active-class="transition-opacity duration-300" enter-from-class="opacity-0">
          <InstructionCard v-if="guidance.kind === 'route'" :dash="roomy" />
        </Transition>
        <HazardChip class="self-center" />
      </div>
    </div>

    <GuidanceSheet
      :ceiling="bannerBottom"
      class="left-[calc(env(safe-area-inset-left)+0.5rem)] right-auto w-[min(26rem,44vw)]"
    >
      <template #above>
        <SpeedPanel :dash="roomy" class="mb-3" />
      </template>
    </GuidanceSheet>

    <RoadNameLabel />

    <GuidanceMapButtons
      :large="roomy"
      class="nav-surface absolute bottom-[calc(env(safe-area-inset-bottom)+1rem)] right-[calc(env(safe-area-inset-right)+1rem)]"
    />
  </div>
</template>
