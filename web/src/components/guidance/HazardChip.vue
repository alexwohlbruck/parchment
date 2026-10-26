<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { TriangleAlertIcon } from 'lucide-vue-next'
import { bannerDistance } from '@/lib/guidance/guidance-display'
import { upcomingHazard } from '@/lib/guidance/hazards'
import { useGuidanceStore } from '@/stores/guidance.store'
import { useGuidanceContext } from './context'

const { t } = useI18n()
const guidance = useGuidanceStore()
const { metric } = useGuidanceContext()

const ahead = computed(() => {
  const route = guidance.followed
  const puck = guidance.progress?.puck
  if (!route || !puck?.snapped || guidance.status !== 'navigating') return null
  const hazard = upcomingHazard(route, puck.s, puck.speed)
  return hazard && { ...hazard, distance: bannerDistance(hazard.distance, metric.value) }
})
</script>

<template>
  <Transition
    enter-active-class="transition duration-200 ease-out"
    enter-from-class="opacity-0 -translate-y-1"
    leave-active-class="transition duration-150 ease-in"
    leave-to-class="opacity-0 -translate-y-1"
  >
    <div
      v-if="ahead"
      class="pointer-events-auto flex w-fit items-center gap-2 rounded-full px-3.5 py-2 text-[15px] font-semibold shadow-lg"
      :class="ahead.hazard.severity === 'high' ? 'bg-amber-400 text-zinc-950' : 'nav-surface bg-background/95 ring-1 ring-foreground/5'"
    >
      <TriangleAlertIcon class="size-4" />
      <span>{{ t(`guidance.hazards.${ahead.hazard.kind}`) }}</span>
      <span class="tabular-nums opacity-70">{{ ahead.distance.value }} {{ t(`guidance.units.${ahead.distance.unit}`) }}</span>
    </div>
  </Transition>
</template>
