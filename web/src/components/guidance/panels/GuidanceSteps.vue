<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import ManeuverIcon from '@/components/directions/ManeuverIcon.vue'
import { maneuverKind } from '@/lib/directions/maneuver'
import { bannerDistance } from '@/lib/guidance/guidance-display'
import { useGuidanceStore } from '@/stores/guidance.store'
import { useGuidanceContext } from '../context'

const { t } = useI18n()
const guidance = useGuidanceStore()
const { metric } = useGuidanceContext()

const upcoming = computed(() => {
  const route = guidance.route
  const s = guidance.progress?.puck.s ?? 0
  if (!route) return []
  return route.steps
    .filter(step => step.startDistance > s)
    .map(step => ({ step, distance: bannerDistance(step.startDistance - s, metric.value) }))
})
</script>

<template>
  <ol class="divide-y">
    <li v-for="{ step, distance } in upcoming" :key="step.index" class="flex items-center gap-3.5 py-3">
      <ManeuverIcon :kind="maneuverKind(step.instruction)" :exit="step.instruction.exitNumber" class="size-6 shrink-0" />
      <span class="min-w-0 flex-1 text-[15px] leading-snug">{{ step.instruction.text }}</span>
      <span class="shrink-0 text-sm text-muted-foreground tabular-nums">
        {{ distance.value }} {{ t(`guidance.units.${distance.unit}`) }}
      </span>
    </li>
  </ol>
</template>
