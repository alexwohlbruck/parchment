<script setup lang="ts">
import { computed } from 'vue'
import dayjs from 'dayjs'
import type { LocationHistoryDailyStats } from '@server/types/location-history.types'

const props = defineProps<{
  stats: LocationHistoryDailyStats[]
  /** Inclusive start of the highlighted band (YYYY-MM-DD). */
  rangeStart: string
  /** Inclusive end of the highlighted band (YYYY-MM-DD). */
  rangeEnd: string
}>()

const emit = defineEmits<{
  (e: 'select', date: string): void
}>()

const maxDistance = computed(() => {
  const max = props.stats.reduce(
    (m, s) => (s.distance > m ? s.distance : m),
    0,
  )
  return max || 1
})

function barHeight(distance: number): string {
  if (distance === 0) return '4%'
  // Square-root scale flattens spikes so quiet days are still readable.
  return `${Math.max(8, Math.sqrt(distance / maxDistance.value) * 100)}%`
}

function tooltip(stat: LocationHistoryDailyStats): string {
  const km = (stat.distance / 1000).toFixed(1)
  return `${dayjs(stat.date).format('ddd, MMM D')} · ${km} km`
}

function isInRange(date: string): boolean {
  return date >= props.rangeStart && date <= props.rangeEnd
}

function isFirstOfMonth(date: string): boolean {
  return dayjs(date).date() === 1
}
</script>

<template>
  <div class="px-3 py-2">
    <div class="flex items-end gap-[2px] h-14 w-full">
      <button
        v-for="stat in stats"
        :key="stat.date"
        type="button"
        :title="tooltip(stat)"
        class="group flex-1 min-w-0 h-full flex flex-col items-center justify-end gap-1 cursor-pointer"
        @click="emit('select', stat.date)"
      >
        <div
          class="w-full rounded-sm transition-all"
          :class="[
            isInRange(stat.date)
              ? 'bg-primary group-hover:opacity-90'
              : 'bg-primary/20 group-hover:bg-primary/40',
          ]"
          :style="{ height: barHeight(stat.distance) }"
        />
      </button>
    </div>
    <!-- Month markers below the bars -->
    <div class="flex gap-[2px] mt-1.5 h-3 text-[10px] text-muted-foreground">
      <div
        v-for="stat in stats"
        :key="`m-${stat.date}`"
        class="flex-1 min-w-0 flex justify-center"
      >
        <span v-if="isFirstOfMonth(stat.date)" class="font-medium">
          {{ dayjs(stat.date).format('MMM') }}
        </span>
      </div>
    </div>
  </div>
</template>
