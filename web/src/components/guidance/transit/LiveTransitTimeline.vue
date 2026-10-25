<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import TransitLegCard from '@/components/transit/trip/TransitLegCard.vue'
import { getSegmentIcon } from '@/lib/directions/travel-mode-icons'
import { formatDurationCompact } from '@/lib/time-format'
import type { TransitStage } from '@/lib/guidance/transit-progress'

defineProps<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  segments: any[]
  /** Index of the segment the traveller is on. */
  current: number
  stage: TransitStage | null
}>()
const { t } = useI18n()

const modeKey = (mode: string) => (mode === 'biking' ? 'cycling' : mode)
</script>

<template>
  <div class="space-y-2">
    <template v-for="(segment, i) in segments" :key="segment.id ?? i">
      <TransitLegCard
        v-if="segment.mode === 'transit' && segment.lineName"
        :segment="segment"
        :rail-above="{ class: 'bg-transparent' }"
        :passed="stage?.kind === 'riding' && stage.segmentIndex === i ? stage.passed : i < current ? Infinity : undefined"
        :class="i < current && 'opacity-50'"
      />
      <div
        v-else
        class="flex items-center gap-3 px-2 py-1.5 text-sm"
        :class="i < current ? 'opacity-50' : i === current ? 'font-medium' : 'text-muted-foreground'"
      >
        <component :is="getSegmentIcon(segment.mode)" class="size-4 shrink-0" />
        <span class="truncate">
          {{ t(`guidance.transit.leg.${modeKey(segment.mode)}`, { duration: formatDurationCompact(segment.duration ?? 0) }) }}
          <template v-if="segment.end?.label"> {{ t('guidance.transit.toPlace', { place: segment.end.label }) }}</template>
        </span>
      </div>
    </template>
  </div>
</template>
