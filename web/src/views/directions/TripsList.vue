<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import dayjs from 'dayjs'
import { useRouter } from 'vue-router'
import type { TripsResponse, TripOption } from '@/types/directions.types'
import { useDirectionsStore } from '@/stores/directions.store'
import TripItem from './TripItem.vue'

interface Props {
  trips: TripsResponse
}

const props = defineProps<Props>()
const router = useRouter()

const directionsStore = useDirectionsStore()

const pixelsPerMinute = 10

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

function navigateToTripDetail(trip: TripOption) {
  // Encode the trip request waypoints so the trip can be reconstructed
  const waypointsParam = props.trips.request.waypoints
    .map(
      wp => `${wp.coordinate.lat.toFixed(6)},${wp.coordinate.lng.toFixed(6)}`,
    )
    .join(';')

  // Navigate to trip detail view with the specific trip ID and reconstruction data
  router.push({
    name: 'trip',
    params: {
      id: trip.id,
    },
    query: {
      // Include trip context
      mode: trip.mode,
      vehicle: trip.vehicleType,
      // Include waypoints for reconstruction
      waypoints: waypointsParam,
      // Include other relevant parameters
      ...(props.trips.request.departureTime && {
        departure: props.trips.request.departureTime.toISOString(),
      }),
      ...(props.trips.request.preferences?.avoidTolls && {
        avoid_tolls: 'true',
      }),
      ...(props.trips.request.preferences?.avoidHighways && {
        avoid_highways: 'true',
      }),
      ...(props.trips.request.preferences?.avoidFerries && {
        avoid_ferries: 'true',
      }),
    },
  })
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
  <div class="flex flex-col h-full">
    <!-- Scrollable container that fills remaining height -->
    <div class="flex-1 relative overflow-auto" ref="containerRef">
      <!-- Time labels - positioned inside scrollable container -->
      <div class="sticky top-0 z-10 pb-6 px-4 pt-2">
        <div class="flex relative">
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
      </div>

      <!-- Grid lines -->
      <div class="absolute inset-0 flex pointer-events-none px-4 top-6">
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

      <!-- Timeline content -->
      <div class="relative flex flex-col space-y-4 px-4 pb-4">
        <TripItem
          v-for="(trip, tripIndex) in sortedTrips"
          :key="trip.id || tripIndex"
          :trip="trip"
          :trip-request="trips.request"
          :earliest-start="earliestStart"
          :pixels-per-minute="pixelsPerMinute"
          @click="navigateToTripDetail"
        />

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
