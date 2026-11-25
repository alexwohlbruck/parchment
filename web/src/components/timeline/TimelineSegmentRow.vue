<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import dayjs from 'dayjs'
import type { LocationHistorySegment } from '@server/types/location-history.types'
import { getModeIcon } from '@/lib/directions/travel-mode-icons'
import { getTravelModeColor } from '@/lib/directions/travel-mode-colors'
import { formatDurationCompact } from '@/lib/time-format'
import { distancePrecision, segmentModeKey } from '@/lib/timeline/timeline-days'
import { useUnits } from '@/composables/useUnits'

const props = defineProps<{
  segment: LocationHistorySegment
  /** YYYY-MM-DD of the day this row is listed under. */
  day: string
}>()

const { t } = useI18n()
const { formatDistance } = useUnits()

const title = computed(() =>
  t(`timeline.modes.${segmentModeKey(props.segment.mode)}`, {
    distance: formatDistance(props.segment.distance, {
      precision: distancePrecision(props.segment.distance),
    }),
  }),
)

const startLabel = computed(() => {
  const start = dayjs(props.segment.startTime)
  return start.format(start.format('YYYY-MM-DD') === props.day ? 'h:mm A' : 'ddd h:mm A')
})
</script>

<template>
  <li class="relative pl-6">
    <span
      class="absolute left-0 top-2 flex size-5 items-center justify-center rounded-full bg-background"
      aria-hidden="true"
    >
      <component
        :is="getModeIcon(segment.mode)"
        class="size-3.5"
        :style="{ color: getTravelModeColor(segment.mode) }"
      />
    </span>
    <div class="px-2 py-2">
      <div class="text-sm text-muted-foreground leading-snug">{{ title }}</div>
      <div class="text-xs text-muted-foreground/80 tabular-nums mt-0.5">
        {{ startLabel }} · {{ formatDurationCompact(segment.duration) }}
      </div>
    </div>
  </li>
</template>
