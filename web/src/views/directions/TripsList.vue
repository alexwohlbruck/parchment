<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import dayjs from 'dayjs'
import {
  FootprintsIcon,
  TrainIcon,
  BikeIcon,
  CarFrontIcon,
} from 'lucide-vue-next'
import type { TripsResponse, TripOption } from '@/types/directions.types'
import { useDirectionsStore } from '@/stores/directions.store'
import { storeToRefs } from 'pinia'

interface Props {
  trips: TripsResponse
}

const props = defineProps<Props>()

const directionsStore = useDirectionsStore()
const { visibleTripIds } = storeToRefs(directionsStore)

const pixelsPerMinute = 10
const legGapPixels = 3
const modeColors = {
  walking: 'bg-blue-300 dark:bg-blue-500',
  driving: 'bg-red-300 dark:bg-red-500',
  cycling: 'bg-green-300 dark:bg-green-500',
  transit: 'bg-indigo-300 dark:bg-indigo-500',
  motorcycle: 'bg-orange-300 dark:bg-orange-500',
  truck: 'bg-gray-300 dark:bg-gray-500',
}

const modeIcons = {
  walking: FootprintsIcon,
  driving: CarFrontIcon,
  cycling: BikeIcon,
  transit: TrainIcon,
  motorcycle: CarFrontIcon,
  truck: CarFrontIcon,
}

// Sort trips by recommended first, then by duration
const sortedTrips = computed(() => {
  return [...props.trips.trips].sort((a, b) => {
    if (a.isRecommended && !b.isRecommended) return -1
    if (!a.isRecommended && b.isRecommended) return 1
    return a.summary.totalDuration - b.summary.totalDuration
  })
})

// Use the timeline bounds from the API response
const earliestStart = computed(() => new Date(props.trips.earliestStart))
const latestEnd = computed(() => new Date(props.trips.latestEnd))

// Generate time labels for the header (15-minute intervals)
const timeLabels = computed(() => {
  const labels: string[] = []
  let currentTime = dayjs(earliestStart.value).startOf('hour')
  const end = dayjs(latestEnd.value).add(1, 'hour').startOf('hour')

  while (currentTime.isBefore(end)) {
    labels.push(currentTime.format('H:mm'))
    currentTime = currentTime.add(15, 'minute')
  }
  return labels
})

function formatDuration(seconds: number) {
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours}h ${remainingMinutes}m`
}

function formatDistance(meters: number) {
  if (meters < 1000) return `${Math.round(meters)} m`
  return `${(meters / 1000).toFixed(1)} km`
}

function getTripCost(trip: TripOption) {
  return trip.cost?.total?.amount || 0
}

function formatCost(amount: number, currency: string = 'USD') {
  if (amount === 0) return 'Free'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amount)
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

// Add these new reactive variables for scroll handling
const containerRef = ref<HTMLElement | null>(null)
const isScrolledToEnd = ref(false)
const isScrolledToStart = ref(true)

// Add scroll handler function
function handleScroll() {
  if (!containerRef.value) return
  const container = containerRef.value
  const isAtEnd =
    container.scrollLeft + container.clientWidth >= container.scrollWidth - 1
  const isAtStart = container.scrollLeft <= 1
  isScrolledToEnd.value = isAtEnd
  isScrolledToStart.value = isAtStart
}

// Add lifecycle hooks
onMounted(() => {
  containerRef.value?.addEventListener('scroll', handleScroll)
})

onUnmounted(() => {
  containerRef.value?.removeEventListener('scroll', handleScroll)
})
</script>

<template>
  <div class="relative overflow-x-hidden max-h-[32rem]">
    <!-- Time labels -->
    <div class="flex relative mb-3">
      <div
        v-for="time in timeLabels"
        :key="time"
        class="flex-shrink-0 text-xs text-muted-foreground absolute ml-2"
        :style="{
          left: `${
            dayjs(
              dayjs(earliestStart)
                .startOf('hour')
                .add(timeLabels.indexOf(time) * 15, 'minute'),
            ).diff(earliestStart, 'minute') * pixelsPerMinute
          }px`,
        }"
      >
        {{ time }}
      </div>
    </div>

    <!-- Grid lines -->
    <div class="absolute inset-0 flex pointer-events-none px-4">
      <div v-for="time in timeLabels" :key="time" class="flex-shrink-0">
        <div
          class="absolute top-0 h-full border-l border-border/50"
          :style="{
            left: `${
              dayjs(
                dayjs(earliestStart)
                  .startOf('hour')
                  .add(timeLabels.indexOf(time) * 15, 'minute'),
              ).diff(earliestStart, 'minute') * pixelsPerMinute
            }px`,
          }"
        />
      </div>
    </div>

    <div class="relative overflow-auto max-h-[32rem]" ref="containerRef">
      <!-- Timeline content -->
      <div class="relative flex flex-col pt-2 pb-4 space-y-5 px-4">
        <div
          v-for="(trip, tripIndex) in sortedTrips"
          :key="trip.id || tripIndex"
          class="relative flex items-start min-h-[3.5rem] group"
        >
          <!-- Trip info sidebar -->
          <div class="flex-shrink-0 w-20 pr-4 text-right">
            <div class="text-sm font-medium text-foreground mb-0.5">
              {{ formatDuration(trip.summary.totalDuration) }}
            </div>
            <div class="text-xs text-muted-foreground">
              {{ formatDistance(trip.summary.totalDistance) }}
            </div>
          </div>

          <!-- Timeline section -->
          <div class="relative flex-1 min-h-[3rem]">
            <!-- Segments bar -->
            <div class="relative h-6 mb-3">
              <div
                v-for="(segment, segmentIndex) in trip.segments"
                :key="segment.id"
                class="absolute rounded-lg transition-all duration-200 flex items-center justify-center shadow-sm h-8"
                :class="[
                  modeColors[segment.mode] || 'bg-gray-300 dark:bg-gray-500',
                  trip.isRecommended
                    ? 'ring-2 ring-primary ring-opacity-40'
                    : '',
                  'group-hover:shadow-md group-hover:scale-[1.02]',
                ]"
                :style="{
                  left: `${
                    dayjs(segment.startTime).diff(earliestStart, 'minute') *
                    pixelsPerMinute
                  }px`,
                  width: `${(segment.duration / 60) * pixelsPerMinute}px`,
                }"
              >
                <!-- Mode icon inside segment -->
                <component
                  :is="modeIcons[segment.mode]"
                  class="size-5 text-white drop-shadow-sm"
                  v-if="(segment.duration / 60) * pixelsPerMinute > 20"
                />
              </div>
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
                  width: `${(segment.duration / 60) * pixelsPerMinute}px`,
                }"
              >
                <!-- Start time -->
                <span class="absolute left-0">
                  {{ getDisplayTime(segment.startTime, segmentIndex === 0) }}
                </span>
                <!-- End time (only show if segment is wide enough to avoid overlap) -->
                <span
                  class="absolute right-0"
                  v-if="(segment.duration / 60) * pixelsPerMinute > 35"
                >
                  {{ getDisplayTime(segment.endTime, false) }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- No trips message -->
        <div
          v-if="sortedTrips.length === 0"
          class="text-center py-8 text-muted-foreground"
        >
          <p class="text-sm">No trips available</p>
        </div>
      </div>
    </div>
  </div>
</template>
