<script setup lang="ts">
import { computed, ref } from 'vue'
import { useWindowSize } from '@vueuse/core'
import { useGuidanceStore } from '@/stores/guidance.store'
import { useObstructingComponent } from '@/composables/sheet/useObstructingComponent'
import InstructionCard from '../InstructionCard.vue'
import HazardChip from '../HazardChip.vue'
import RoadNameLabel from '../RoadNameLabel.vue'
import SpeedPanel from '../SpeedPanel.vue'
import GuidanceMapButtons from '../GuidanceMapButtons.vue'
import GuidanceNotices from '../GuidanceNotices.vue'
import GuidanceEta from '../GuidanceEta.vue'
import ArrivalPanel from '../ArrivalPanel.vue'
import GuidancePanel from '../panels/GuidancePanel.vue'
import { useGuidanceContext } from '../context'

defineSlots<{ dev?: (props: { placement: 'above' | 'below' }) => unknown }>()
const guidance = useGuidanceStore()
const { panel, exit, metric } = useGuidanceContext()

const root = ref<HTMLElement | null>(null)
const column = ref<HTMLElement | null>(null)
// Measured off the root, which resizes as the rail leaves; the column itself only moves.
useObstructingComponent(root, 'guidance-column', undefined, undefined, rect => ({
  ...rect,
  width: Math.round((column.value?.getBoundingClientRect().right ?? rect.x) - rect.x),
}))

// Landscape phones get the column without the arm's-length sizing.
const { height } = useWindowSize()
const roomy = computed(() => height.value >= 600)

const CARD = 'nav-surface pointer-events-auto rounded-[28px] bg-background/95 shadow-xl ring-1 ring-foreground/5 backdrop-blur-md'
</script>

<template>
  <div ref="root" class="pointer-events-none absolute inset-0 z-30 select-none">
    <div
      ref="column"
      class="absolute inset-y-0 left-0 flex w-[min(26rem,44vw)] flex-col gap-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] pl-[calc(env(safe-area-inset-left)+1rem)] pt-[calc(env(safe-area-inset-top)+1rem)]"
    >
      <div class="absolute left-full top-[calc(env(safe-area-inset-top)+1rem)] ml-3">
        <slot name="dev" placement="below" />
      </div>
      <Transition appear enter-active-class="transition-opacity duration-300" enter-from-class="opacity-0">
        <InstructionCard :dash="roomy" />
      </Transition>
      <HazardChip class="self-center" />
      <GuidanceNotices />

      <Transition
        mode="out-in"
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="opacity-0 -translate-x-3"
        leave-active-class="transition duration-150 ease-in"
        leave-to-class="opacity-0 -translate-x-3"
      >
        <div v-if="panel" :key="panel" class="min-h-0 overflow-y-auto p-5" :class="CARD">
          <GuidancePanel :kind="panel" menu-header />
        </div>
      </Transition>

      <div class="mt-auto flex flex-col items-start gap-3">
        <SpeedPanel :dash="roomy" />
        <Transition appear enter-active-class="transition-opacity duration-300" enter-from-class="opacity-0">
          <div class="w-full p-5" :class="CARD">
            <ArrivalPanel
              v-if="guidance.status === 'arrived'"
              :destination="guidance.destinationLabel"
              :has-next-leg="guidance.nextLeg != null"
              @done="exit"
              @next="guidance.startNextLeg()"
            />
            <GuidanceEta v-else :dash="roomy" :progress="guidance.progress" :metric="metric" @exit="exit" />
          </div>
        </Transition>
      </div>
    </div>

    <RoadNameLabel />

    <GuidanceMapButtons
      panels
      :large="roomy"
      class="nav-surface absolute bottom-[calc(env(safe-area-inset-bottom)+1rem)] right-[calc(env(safe-area-inset-right)+1rem)]"
    />

  </div>
</template>
