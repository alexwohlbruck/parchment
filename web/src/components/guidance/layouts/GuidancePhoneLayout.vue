<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app.store'
import { useGuidanceStore } from '@/stores/guidance.store'
import { useObstructingComponent } from '@/composables/sheet/useObstructingComponent'
import { restingFootprint } from '@/lib/guidance/guidance-layout'
import InstructionCard from '../InstructionCard.vue'
import HazardChip from '../HazardChip.vue'
import RoadNameLabel from '../RoadNameLabel.vue'
import SpeedPanel from '../SpeedPanel.vue'
import GuidanceMapButtons from '../GuidanceMapButtons.vue'
import GuidanceNotices from '../GuidanceNotices.vue'
import GuidanceEta from '../GuidanceEta.vue'
import ArrivalPanel from '../ArrivalPanel.vue'
import GuidancePanel from '../panels/GuidancePanel.vue'
import { useGuidanceContext, type GuidancePanelKind } from '../context'

const { t } = useI18n()
const appStore = useAppStore()
defineSlots<{ dev?: (props: { placement: 'above' | 'below' }) => unknown }>()
const guidance = useGuidanceStore()
const { panel, openPanel, closePanel, exit, metric } = useGuidanceContext()

const root = ref<HTMLElement | null>(null)
const banner = ref<HTMLElement | null>(null)
const dock = ref<HTMLElement | null>(null)
const overflow = ref<HTMLElement | null>(null)

useObstructingComponent(banner, 'guidance-banner')
useObstructingComponent(dock, 'guidance-dock', undefined, undefined, rect =>
  restingFootprint(rect, overflow.value?.getBoundingClientRect().height ?? 0),
)

const expanded = computed(() => panel.value != null)

// The panel stays mounted while the card closes over it.
const shown = ref<GuidancePanelKind | null>(null)
watch(panel, next => {
  if (next) shown.value = next
})
function onOverflowSettled(event: TransitionEvent) {
  if (event.target === event.currentTarget && !panel.value) shown.value = null
}

function toggle() {
  if (expanded.value) closePanel(true)
  else openPanel('menu')
}

const SWIPE_PX = 24
let dragFrom: number | null = null
function onPointerDown(event: PointerEvent) {
  dragFrom = event.clientY
}
function onPointerUp(event: PointerEvent) {
  if (dragFrom == null) return
  const dy = event.clientY - dragFrom
  dragFrom = null
  if (dy < -SWIPE_PX && !expanded.value) openPanel('menu')
  else if (dy > SWIPE_PX && expanded.value) closePanel(true)
  else if (Math.abs(dy) < SWIPE_PX && !(event.target as Element).closest('button')) toggle()
}

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

    <Transition appear enter-active-class="transition-opacity duration-300" enter-from-class="opacity-0">
      <div ref="dock" class="absolute inset-x-0 bottom-0 flex flex-col gap-2 px-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)]">
        <GuidanceNotices />
        <div class="nav-surface pointer-events-auto overflow-hidden rounded-[28px] bg-background shadow-xl ring-1 ring-foreground/5">
          <div
            class="touch-none px-5 pb-4 pt-2"
            :aria-expanded="expanded"
            @pointerdown="onPointerDown"
            @pointerup="onPointerUp"
            @pointercancel="dragFrom = null"
          >
            <button
              class="mx-auto mb-2 flex h-4 w-12 items-center justify-center"
              :aria-label="expanded ? t('guidance.menu.hide') : t('guidance.menu.show')"
              @click="toggle"
            >
              <span class="h-1.5 w-10 rounded-full bg-muted-foreground/30" />
            </button>
            <ArrivalPanel
              v-if="guidance.status === 'arrived'"
              :destination="guidance.destinationLabel"
              :has-next-leg="guidance.nextLeg != null"
              @done="exit"
              @next="guidance.startNextLeg()"
            />
            <GuidanceEta v-else :progress="guidance.progress" :metric="metric" @exit="exit" />
          </div>
          <div
            ref="overflow"
            class="grid transition-[grid-template-rows] duration-300 ease-out"
            :class="expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'"
            @transitionend="onOverflowSettled"
          >
            <div class="min-h-0 overflow-hidden">
              <div class="max-h-[62dvh] overflow-y-auto border-t px-4 pb-5 pt-4">
                <GuidancePanel v-if="shown" :kind="shown" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>
