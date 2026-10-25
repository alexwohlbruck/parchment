<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import { useI18n } from 'vue-i18n'
import { RouteIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import CameraModeButton from '@/components/guidance/CameraModeButton.vue'
import PanelLayout from '@/components/sheet/layouts/PanelLayout.vue'
import { useGuidanceStore } from '@/stores/guidance.store'
import { useGuidanceCamera } from '@/composables/guidance/useGuidanceCamera'
import { useUnits } from '@/composables/useUnits'

const GuidanceDevTools = import.meta.env.DEV
  ? defineAsyncComponent(() => import('@/dev/guidance/GuidanceDevTools.vue'))
  : null

const router = useRouter()
const { t } = useI18n()
const guidance = useGuidanceStore()
const { formatDistance, formatSpeed } = useUnits()

if (!guidance.isActive) router.replace({ name: AppRoute.DIRECTIONS })

const camera = useGuidanceCamera()

const nextStep = computed(() => {
  const progress = guidance.progress
  return progress ? guidance.route?.steps[progress.stepIndex + 1] ?? null : null
})

function exit() {
  guidance.stop()
  router.back()
}

onBeforeUnmount(() => guidance.stop())
</script>

<template>
  <PanelLayout>
    <!-- Right padding clears the sheet's floating back / close chrome. -->
    <div class="min-w-0 pr-24">
      <template v-if="guidance.progress">
        <div v-if="nextStep" class="flex items-baseline gap-2">
          <span class="shrink-0 whitespace-nowrap font-display text-[28px] leading-none tabular-nums">
            {{ formatDistance(guidance.progress.distanceToNextStep ?? 0) }}
          </span>
          <span class="truncate text-base">{{ nextStep.instruction.text }}</span>
        </div>
        <div class="mt-1.5 text-sm text-muted-foreground tabular-nums">
          {{ t('guidance.remaining', { distance: formatDistance(guidance.progress.remaining) }) }}
          · {{ formatSpeed(guidance.progress.puck.speed) }}
          <span v-if="!guidance.progress.puck.snapped" class="text-amber-600">
            · {{ t('guidance.offRoute') }}
          </span>
        </div>
      </template>
      <div v-else class="text-muted-foreground">{{ t('guidance.waitingForLocation') }}</div>
    </div>

    <div class="mt-3 flex items-center gap-2">
      <Button variant="secondary" size="sm" @click="exit">{{ t('guidance.exit') }}</Button>
      <div class="ml-auto flex gap-1.5">
        <Button
          size="icon"
          :variant="camera.state.value === 'overview' ? 'default' : 'secondary'"
          :title="t('guidance.camera.overview')"
          :aria-label="t('guidance.camera.overview')"
          @click="camera.state.value === 'overview' ? camera.follow() : camera.overview()"
        >
          <RouteIcon class="size-5" />
        </Button>
        <CameraModeButton
          :mode="guidance.preferences.cameraMode"
          :state="camera.state.value"
          @press="camera.pressCameraButton"
        />
      </div>
    </div>

    <component :is="GuidanceDevTools" v-if="GuidanceDevTools" class="mt-3" />
  </PanelLayout>
</template>
