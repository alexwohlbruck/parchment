<script setup lang="ts">
import { useMapService } from '@/services/map/map.service'
import { useUnits } from '@/composables/useUnits'
import TripMeta from './TripMeta.vue'
import TripBar from './TripBar.vue'
import type { AdviceStatus } from '@/lib/directions/trip-advice'
import type {
  TripOption,
  TripsResponse,
} from '@/types/directions.types'
import { formatDurationParts } from '@/lib/time-format'

interface Props {
  trip: TripOption
  status?: AdviceStatus | null
  tripRequest: TripsResponse['request']
  timelineStart: Date
  pxPerMinute: number
  sidebarWidth: number
  /** Visible width of the bar column; bounds the pinned summary. */
  barAreaWidth: number
  isClickable?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  isClickable: true,
})

const emit = defineEmits<{
  click: [trip: TripOption]
}>()

const mapService = useMapService()
const { formatDistance } = useUnits()

function getArrivalTime() {
  const lastSegment = props.trip.segments[props.trip.segments.length - 1]
  if (!lastSegment) return ''
  return new Date(lastSegment.endTime).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function handleClick() {
  if (props.isClickable) {
    emit('click', props.trip)
  }
}

function handleMouseEnter() {
  mapService.showTripOnHover(props.trip.id)
}
</script>

<template>
  <div
    class="grid py-3 transition-colors"
    :class="{ 'cursor-pointer hover:bg-accent/50': isClickable }"
    :style="{ gridTemplateColumns: sidebarWidth ? `${sidebarWidth}px 1fr` : 'auto 1fr' }"
    @click="handleClick"
    @mouseenter="handleMouseEnter"
  >
    <!-- Duration sidebar -->
    <div data-sidebar class="text-right tabular-nums pt-0.5 pl-3 pr-5 whitespace-nowrap">
      <div class="text-base font-semibold leading-tight">
        <template v-for="(part, i) in formatDurationParts(trip.summary.totalDuration).parts" :key="i">
          <span v-if="i > 0" class="inline-block w-1" />{{ part.value }}<span class="text-[11px] font-medium ml-px">{{ part.unit }}</span>
        </template>
      </div>
      <div class="text-[10px] text-muted-foreground font-medium mt-0.5">
        {{ getArrivalTime() }}
      </div>
      <div class="text-[10px] text-muted-foreground font-medium">
        {{ formatDistance(trip.summary.totalDistance) }}
      </div>
    </div>

    <!-- Bar + meta -->
    <div>
      <TripBar :segments="trip.segments" :timeline-start="timelineStart" :px-per-minute="pxPerMinute" />

      <!-- Trip summary — travels with the bar, then pins at the panel edge -->
      <div class="sticky left-3 w-fit" :style="{ maxWidth: `${barAreaWidth}px` }">
        <TripMeta :trip="trip" :status="status" class="mt-1.5 pr-4" />
      </div>
    </div>
  </div>
</template>
