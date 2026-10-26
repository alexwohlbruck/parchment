<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { onKeyStroke } from '@vueuse/core'
import { AppRoute } from '@/router'
import { useResponsive } from '@/lib/utils'
import PreviewStepCard from '@/components/guidance/preview/PreviewStepCard.vue'
import PreviewStepList from '@/components/guidance/preview/PreviewStepList.vue'
import { useGuidanceRouteLine } from '@/composables/guidance/useGuidanceRouteLine'
import { useRoutePreviewCamera } from '@/composables/guidance/useRoutePreviewCamera'
import { useObstructingComponent } from '@/composables/sheet/useObstructingComponent'
import { modeProfile } from '@/lib/guidance/mode-profiles'
import { travelModeAt } from '@/lib/guidance/guidance-display'
import { useRoutePreviewStore } from '@/stores/route-preview.store'
import { useAppStore } from '@/stores/app.store'
import { UnitSystem } from '@/types/map.types'

const router = useRouter()
const preview = useRoutePreviewStore()
const { isMobileScreen } = useResponsive()
const { unitSystem } = storeToRefs(useAppStore())
const metric = computed(() => unitSystem.value === UnitSystem.METRIC)

if (!preview.isOpen) router.replace({ name: AppRoute.DIRECTIONS })

useGuidanceRouteLine({
  route: () => preview.route,
  focus: () => {
    const route = preview.route
    const step = preview.step
    if (!route) return null
    const s = step ? preview.steps[step.index - 1]?.startDistance ?? 0 : 0
    const speed = modeProfile(travelModeAt(route, s)).baseSpeed
    return { s, speed, travelled: s, next: step, hazards: step != null }
  },
})

const camera = useRoutePreviewCamera()
function frame() {
  const route = preview.route
  if (!route) return
  if (preview.step) camera.focus(route, preview.step)
  else camera.overview(route)
}

const panel = ref<HTMLElement | null>(null)
useObstructingComponent(panel, 'route-preview')

onMounted(() => {
  watch(() => [preview.route, preview.stepIndex], frame, { immediate: true })
})

onKeyStroke('ArrowRight', () => preview.next())
onKeyStroke('ArrowLeft', () => preview.previous())
onKeyStroke('Escape', close)

function close() {
  router.back()
}

onBeforeUnmount(() => preview.close())
</script>

<template>
  <div class="pointer-events-none absolute inset-0 z-30 select-none">
    <div
      v-if="isMobileScreen"
      ref="panel"
      class="absolute inset-x-0 bottom-0 px-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)]"
    >
      <PreviewStepCard :metric="metric" @close="close" />
    </div>
    <div
      v-else
      ref="panel"
      class="absolute inset-y-0 left-0 flex w-[min(26rem,44vw)] flex-col gap-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] pl-[calc(env(safe-area-inset-left)+1rem)] pt-[calc(env(safe-area-inset-top)+1rem)]"
    >
      <PreviewStepCard :metric="metric" @close="close" />
      <div class="nav-card min-h-0 overflow-y-auto p-2">
        <PreviewStepList :metric="metric" />
      </div>
    </div>
  </div>
</template>
