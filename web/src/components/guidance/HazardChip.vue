<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { TriangleAlertIcon } from 'lucide-vue-next'
import { bannerDistance } from '@/lib/guidance/guidance-display'
import type { NavHazard } from '@/lib/guidance/nav-route'

const props = defineProps<{ hazard: NavHazard; distance: number; metric: boolean }>()
const { t } = useI18n()
const spoken = () => bannerDistance(props.distance, props.metric)
</script>

<template>
  <div
    class="pointer-events-auto mx-auto mt-2 flex w-fit items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium shadow-md"
    :class="hazard.severity === 'high' ? 'bg-amber-400 text-zinc-950' : 'bg-background text-foreground'"
  >
    <TriangleAlertIcon class="size-4" />
    <span>{{ t(`guidance.hazards.${hazard.kind}`) }}</span>
    <span class="tabular-nums opacity-70">{{ spoken().value }} {{ t(`guidance.units.${spoken().unit}`) }}</span>
  </div>
</template>
