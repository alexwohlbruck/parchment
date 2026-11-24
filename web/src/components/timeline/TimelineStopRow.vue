<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import dayjs from 'dayjs'
import type { LocationHistoryStop } from '@server/types/location-history.types'
import { formatDurationCompact } from '@/lib/time-format'

const props = defineProps<{
  stop: LocationHistoryStop
  /** YYYY-MM-DD of the day this row is listed under. */
  day: string
}>()

const emit = defineEmits<{
  select: [stop: LocationHistoryStop]
}>()

const { t } = useI18n()

const timeRange = computed(() => {
  const start = dayjs(props.stop.startTime)
  const startFormat = start.format('YYYY-MM-DD') === props.day ? 'h:mm A' : 'ddd h:mm A'
  return `${start.format(startFormat)} – ${dayjs(props.stop.endTime).format('h:mm A')}`
})

const displayName = computed(
  () => props.stop.name?.trim() || t('timeline.unnamedStop'),
)
</script>

<template>
  <li class="relative pl-6">
    <span class="absolute left-0 top-2 flex size-5 items-center justify-center" aria-hidden="true">
      <span class="size-2.5 rounded-full bg-primary ring-4 ring-background" />
    </span>
    <button
      type="button"
      class="w-full text-left px-2 py-2 rounded-md hover:bg-muted/70 transition-colors"
      @click="emit('select', stop)"
    >
      <div class="text-sm font-medium text-foreground leading-snug truncate">
        {{ displayName }}
      </div>
      <div class="text-xs text-muted-foreground tabular-nums mt-0.5">
        {{ timeRange }} · {{ formatDurationCompact(stop.duration) }}
      </div>
    </button>
  </li>
</template>
