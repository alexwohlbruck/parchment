<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { AppRoute } from '@/router'
import PanelLayout from '@/components/sheet/layouts/PanelLayout.vue'
import { SheetHeader } from '@/components/sheet'
import GuidanceOverlay from '@/components/guidance/GuidanceOverlay.vue'
import GuidanceBottomBar from '@/components/guidance/GuidanceBottomBar.vue'
import GuidanceMenu from '@/components/guidance/GuidanceMenu.vue'
import ArrivalPanel from '@/components/guidance/ArrivalPanel.vue'
import { useGuidanceStore } from '@/stores/guidance.store'
import { useAppStore } from '@/stores/app.store'
import { useGuidanceCamera } from '@/composables/guidance/useGuidanceCamera'
import { useGuidanceRouteLine } from '@/composables/guidance/useGuidanceRouteLine'
import { UnitSystem } from '@/types/map.types'

const GuidanceDevTools = import.meta.env.DEV
  ? defineAsyncComponent(() => import('@/dev/guidance/GuidanceDevTools.vue'))
  : null

const router = useRouter()
const guidance = useGuidanceStore()
const { unitSystem } = storeToRefs(useAppStore())
const metric = computed(() => unitSystem.value === UnitSystem.METRIC)

if (!guidance.isActive) router.replace({ name: AppRoute.DIRECTIONS })

const camera = useGuidanceCamera()
useGuidanceRouteLine()

function exit() {
  guidance.stop()
  router.back()
}

// With nothing left to navigate, the arrival card closes itself.
const ARRIVAL_DISMISS_MS = 30_000
let dismissTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => guidance.status,
  status => {
    if (dismissTimer) clearTimeout(dismissTimer)
    dismissTimer = status === 'arrived' && guidance.nextLeg == null ? setTimeout(exit, ARRIVAL_DISMISS_MS) : null
  },
)
onBeforeUnmount(() => {
  if (dismissTimer) clearTimeout(dismissTimer)
})

onBeforeUnmount(() => guidance.stop())
</script>

<template>
  <PanelLayout>
    <SheetHeader class="-mx-3 -mt-[var(--panel-inset-top)] px-3 pt-4 pb-3">
      <ArrivalPanel
        v-if="guidance.status === 'arrived'"
        :destination="guidance.destinationLabel"
        :has-next-leg="guidance.nextLeg != null"
        @done="exit"
        @next="guidance.startNextLeg()"
      />
      <GuidanceBottomBar v-else :progress="guidance.progress" :metric="metric" @exit="exit" />
    </SheetHeader>
    <GuidanceMenu :camera="camera" :metric="metric" @exit="exit" />
    <component :is="GuidanceDevTools" v-if="GuidanceDevTools" class="mt-4" />
  </PanelLayout>

  <Teleport to="#mainContent">
    <GuidanceOverlay :camera="camera" :metric="metric" />
  </Teleport>
</template>
