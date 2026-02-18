<script setup lang="ts">
import { computed } from 'vue'
import dayjs from 'dayjs'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useMapService } from '@/services/map.service'
import { useUnits } from '@/composables/useUnits'
import { getTravelModeCssClass } from '@/lib/travel-mode-colors'
import {
  FootprintsIcon,
  TrainIcon,
  BikeIcon,
  CarFrontIcon,
  TruckIcon,
  TrendingUpIcon,
  TrendingDownIcon,
  MountainIcon,
} from 'lucide-vue-next'
import type {
  TripOption,
  TripsResponse,
  TravelMode,
} from '@/types/directions.types'

interface Props {
  trip: TripOption
  tripRequest: TripsResponse['request']
  earliestStart: Date
  pixelsPerMinute?: number
  isClickable?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  pixelsPerMinute: 10,
  isClickable: true,
})

const emit = defineEmits<{
  click: [trip: TripOption]
}>()

const router = useRouter()
const mapService = useMapService()
const { t } = useI18n()
const { formatDistance, formatElevation } = useUnits()

const modeIcons = {
  walking: FootprintsIcon,
  driving: CarFrontIcon,
  cycling: BikeIcon,
  biking: BikeIcon, // Alias for cycling
  transit: TrainIcon,
  motorcycle: CarFrontIcon,
  truck: TruckIcon,
}

// Computed property to detect multimodal trips (walking + vehicle)
const isMultimodalTrip = computed(() => {
  const modes = new Set(props.trip.segments.map(s => s.mode as TravelMode))
  return (
    modes.has('walking' as TravelMode) &&
    (modes.has('driving' as TravelMode) ||
      modes.has('cycling' as TravelMode) ||
      (modes as any).has('biking'))
  )
})

// Computed property to get trip description
const tripDescription = computed(() => {
  if (props.trip.segments.length === 1) {
    const segment = props.trip.segments[0]
    return getTripModeLabel(segment.mode)
  }

  if (isMultimodalTrip.value) {
    const vehicleSegment = props.trip.segments.find(s => s.mode !== 'walking')
    if (vehicleSegment) {
      return `Walk to ${vehicleSegment.vehicleType || vehicleSegment.mode}`
    }
  }

  return 'Mixed modes'
})

// Check if elevation data is available and relevant (bike/pedestrian modes)
const hasElevationData = computed(() => {
  return (
    (props.trip.mode === 'cycling' || props.trip.mode === 'walking') &&
    props.trip.summary.totalElevationGain !== undefined
  )
})

function getTripModeLabel(mode: string): string {
  const normalizedMode = mode === 'biking' ? 'cycling' : mode
  return t(`directions.modes.${normalizedMode}`)
}

function formatDuration(seconds: number) {
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours}h ${remainingMinutes}m`
}

function getDisplayTime(date: Date, isFirstSegment: boolean = false) {
  // Only show "Now" for the first segment if it starts immediately (within 2 minutes)
  if (isFirstSegment) {
    const now = new Date()
    const diffMinutes = dayjs(date).diff(now, 'minute')

    if (Math.abs(diffMinutes) <= 2) {
      return 'Now'
    }
  }

  return dayjs(date).format('H:mm')
}

function getSegmentTooltip(segment: any): string {
  const duration = formatDuration(segment.duration)
  const distance = segment.distance ? formatDistance(segment.distance) : ''
  const mode = getTripModeLabel(segment.mode)

  let tooltip = `${mode}: ${duration}${distance ? ', ' + distance : ''}`

  // Add elevation info for bike/pedestrian segments if available
  if (
    (segment.mode === 'cycling' ||
      segment.mode === 'biking' ||
      segment.mode === 'walking') &&
    segment.instructions &&
    segment.instructions.length > 0
  ) {
    const elevationGain = segment.instructions.reduce(
      (total: number, inst: any) => total + (inst.elevationGain || 0),
      0,
    )
    const elevationLoss = segment.instructions.reduce(
      (total: number, inst: any) => total + (inst.elevationLoss || 0),
      0,
    )

    if (elevationGain > 0) {
      tooltip += `\n↗ ${formatElevation(elevationGain)} climb`
    }
    if (elevationLoss > 0) {
      tooltip += `\n↘ ${formatElevation(elevationLoss)} descent`
    }
  }

  return tooltip
}

function handleClick() {
  if (props.isClickable) {
    emit('click', props.trip)
  }
}

function handleMouseEnter() {
  // Show this trip's route on the map
  mapService.showTripOnHover(props.trip.id)
}

function navigateToTripDetail() {
  if (!props.isClickable) return

  // Encode the trip request waypoints so the trip can be reconstructed
  const waypointsParam = props.tripRequest.waypoints
    .map(
      wp => `${wp.coordinate.lat.toFixed(6)},${wp.coordinate.lng.toFixed(6)}`,
    )
    .join(';')

  // Navigate to trip detail view with the specific trip ID and reconstruction data
  router.push({
    name: 'trip',
    params: {
      id: props.trip.id,
    },
    query: {
      // Include trip context
      mode: props.trip.mode,
      vehicle: props.trip.vehicleType,
      // Include waypoints for reconstruction
      waypoints: waypointsParam,
      // Include other relevant parameters
      ...(props.tripRequest.departureTime && {
        departure: props.tripRequest.departureTime.toISOString(),
      }),
      ...(props.tripRequest.preferences?.avoidTolls && { avoid_tolls: 'true' }),
      ...(props.tripRequest.preferences?.avoidHighways && {
        avoid_highways: 'true',
      }),
      ...(props.tripRequest.preferences?.avoidFerries && {
        avoid_ferries: 'true',
      }),
    },
  })
}
</script>

<template>
  <div
    class="relative flex items-start min-h-16 group"
    :class="{
      'cursor-pointer hover:bg-accent/50 rounded-lg p-2 -m-2 transition-colors':
        isClickable,
    }"
    @click="handleClick"
    @mouseenter="handleMouseEnter"
  >
    <!-- Trip info sidebar -->
    <div class="shrink-0 pr-4 text-right">
      <div class="text-sm font-medium text-foreground mb-0.5">
        {{ formatDuration(trip.summary.totalDuration) }}
      </div>
      <div class="text-xs text-muted-foreground mb-1">
        {{ formatDistance(trip.summary.totalDistance) }}
      </div>

      <!-- Elevation data for bike/pedestrian modes -->
      <div v-if="hasElevationData" class="flex flex-col gap-0.5 mt-1">
        <div
          v-if="
            trip.summary.totalElevationGain &&
            trip.summary.totalElevationGain > 0
          "
          class="flex items-center justify-end gap-1 text-xs text-green-600"
          :title="`Total elevation gain: ${formatElevation(trip.summary.totalElevationGain)}`"
        >
          <TrendingUpIcon class="size-3" />
          <span>{{ formatElevation(trip.summary.totalElevationGain) }}</span>
        </div>
        <div
          v-if="
            trip.summary.totalElevationLoss &&
            trip.summary.totalElevationLoss > 0
          "
          class="flex items-center justify-end gap-1 text-xs text-red-600"
          :title="`Total elevation loss: ${formatElevation(trip.summary.totalElevationLoss)}`"
        >
          <TrendingDownIcon class="size-3" />
          <span>{{ formatElevation(trip.summary.totalElevationLoss) }}</span>
        </div>
        <div
          v-if="trip.summary.maxElevation"
          class="flex items-center justify-end gap-1 text-xs text-muted-foreground"
          :title="`Highest point: ${formatElevation(trip.summary.maxElevation)}`"
        >
          <MountainIcon class="size-3" />
          <span>{{ formatElevation(trip.summary.maxElevation) }}</span>
        </div>
      </div>

      <!-- Cost display if available -->
      <div v-if="trip.cost?.total" class="text-xs text-muted-foreground mt-1">
        ${{ trip.cost.total.amount.toFixed(2) }}
      </div>
    </div>

    <!-- Timeline section -->
    <div class="relative flex-1 min-h-12">
      <!-- Segments bar -->
      <div class="relative h-8 mb-3">
        <div
          v-for="(segment, segmentIndex) in trip.segments"
          :key="segment.id"
          class="absolute rounded-full transition-all duration-200 flex items-center shadow-xs h-8 group/segment overflow-hidden"
          :class="[
            getTravelModeCssClass(segment.mode),
            'group-hover:shadow-md group-hover:scale-[1.02]',
            // Add visual connection for multimodal trips
            isMultimodalTrip && segmentIndex > 0 ? 'ml-0.5' : '',
          ]"
          :style="{
            left: `${
              dayjs(segment.startTime).diff(earliestStart, 'minute') *
              pixelsPerMinute
            }px`,
            width: `${Math.max(
              (segment.duration / 60) * pixelsPerMinute,
              40, // Match the minimum width for pill shape
            )}px`,
          }"
          :title="getSegmentTooltip(segment)"
        >
          <!-- Icon circle on the left -->
          <div
            class="shrink-0 w-6 h-6 bg-black/20 rounded-full flex items-center justify-center ml-1"
          >
            <component
              :is="modeIcons[segment.mode]"
              class="size-3 text-white drop-shadow-xs"
            />
          </div>

          <!-- Segment text (only show if there's enough space) -->
          <div
            v-if="(segment.duration / 60) * pixelsPerMinute > 60"
            class="flex-1 px-2 text-xs font-medium text-white truncate"
          >
            {{ getTripModeLabel(segment.mode) }}
          </div>

          <!-- Tooltip on hover -->
          <div
            class="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-black text-white text-xs rounded opacity-0 group-hover/segment:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-10"
          >
            {{ getSegmentTooltip(segment) }}
          </div>
        </div>

        <!-- Connection lines for multimodal trips -->
        <div
          v-if="isMultimodalTrip && trip.segments.length > 1"
          v-for="(segment, segmentIndex) in trip.segments.slice(0, -1)"
          :key="`connection-${segment.id}`"
          class="absolute top-1/2 transform -translate-y-1/2 h-0.5 bg-border"
          :style="{
            left: `${
              dayjs(segment.startTime).diff(earliestStart, 'minute') *
                pixelsPerMinute +
              Math.max((segment.duration / 60) * pixelsPerMinute, 40)
            }px`,
            width: `${Math.max(
              dayjs(trip.segments[segmentIndex + 1].startTime).diff(
                segment.endTime,
                'minute',
              ) * pixelsPerMinute,
              0,
            )}px`,
          }"
        />
      </div>

      <!-- Timestamps below the bar -->
      <div class="relative h-5">
        <div
          v-for="(segment, segmentIndex) in trip.segments"
          :key="`${segment.id}-times`"
          class="absolute text-[10px] text-muted-foreground tracking-tight"
          :style="{
            left: `${
              dayjs(segment.startTime).diff(earliestStart, 'minute') *
              pixelsPerMinute
            }px`,
            width: `${Math.max(
              (segment.duration / 60) * pixelsPerMinute,
              40, // Match the minimum width for pill shape
            )}px`,
          }"
        >
          <!-- Start time -->
          <span class="absolute left-0">
            {{ getDisplayTime(segment.startTime, segmentIndex === 0) }}
          </span>
          <!-- End time (only show if segment is wide enough to avoid overlap) -->
          <span
            class="absolute right-0"
            v-if="(segment.duration / 60) * pixelsPerMinute > 50"
          >
            {{ getDisplayTime(segment.endTime, false) }}
          </span>
        </div>
      </div>

      <!-- Instructions summary for multimodal trips -->
      <!-- Removed instructions summary - leaving for detail page -->
    </div>
  </div>
</template>
