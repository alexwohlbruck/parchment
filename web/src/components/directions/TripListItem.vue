<script setup lang="ts">
import { computed } from 'vue'
import { useMapService } from '@/services/map/map.service'
import { formatTimeRange } from '@/lib/directions/trip-display'
import { formatDurationParts } from '@/lib/time-format'
import type { TripOption } from '@/types/directions.types'
import TripLegChips from './TripLegChips.vue'
import TripMeta from './TripMeta.vue'

interface Props {
  trip: TripOption
  isClickable?: boolean
}

const props = withDefaults(defineProps<Props>(), { isClickable: true })

const emit = defineEmits<{ click: [trip: TripOption] }>()

const mapService = useMapService()

const duration = computed(
  () => formatDurationParts(props.trip.summary.totalDuration).parts,
)

const timeRange = computed(() => {
  const segments = props.trip.segments
  if (!segments.length) return ''
  return formatTimeRange(
    new Date(segments[0].startTime),
    new Date(segments[segments.length - 1].endTime),
  )
})

function handleClick() {
  if (props.isClickable) emit('click', props.trip)
}
</script>

<template>
  <div
    class="px-4 py-3 space-y-2 transition-colors"
    :class="{ 'cursor-pointer hover:bg-accent/50': isClickable }"
    @click="handleClick"
    @mouseenter="mapService.showTripOnHover(trip.id)"
  >
    <div class="flex items-baseline gap-2">
      <span class="text-lg font-semibold leading-none tabular-nums">
        <template v-for="(part, i) in duration" :key="i">
          <span v-if="i > 0" class="inline-block w-1" />{{ part.value
          }}<span class="text-xs font-medium ml-px">{{ part.unit }}</span>
        </template>
      </span>
      <span class="flex-1" />
      <span class="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
        {{ timeRange }}
      </span>
    </div>

    <TripLegChips :segments="trip.segments" />

    <TripMeta :trip="trip" show-distance />
  </div>
</template>
