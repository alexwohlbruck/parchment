<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import dayjs from 'dayjs'
import { FootprintsIcon, TrainIcon, BikeIcon } from 'lucide-vue-next'
import Trip from './Trip.vue'

interface TripLeg {
  mode: 'walk' | 'train' | 'bike'
  duration: number // in minutes
  startTime: Date
}

interface Trip {
  legs: TripLeg[]
}

// Hardcoded sample data
const now = new Date()
const trips: Trip[] = [
  {
    legs: [
      {
        mode: 'walk',
        duration: 5,
        startTime: dayjs(now).add(4, 'minute').toDate(),
      },
      {
        mode: 'train',
        duration: 10,
        startTime: dayjs(now).add(9, 'minute').toDate(),
      },
      {
        mode: 'walk',
        duration: 6,
        startTime: dayjs(now).add(19, 'minute').toDate(),
      },
    ],
  },
  {
    legs: [{ mode: 'bike', duration: 15, startTime: now }],
  },
  {
    legs: [{ mode: 'walk', duration: 54, startTime: now }],
  },
]

const pixelsPerMinute = 10
const legGapPixels = 3
const modeColors = {
  walk: 'bg-blue-300 dark:bg-blue-500',
  train: 'bg-indigo-300 dark:bg-indigo-500',
  bike: 'bg-green-300 dark:bg-green-500',
  bus: 'bg-violet-300 dark:bg-violet-500',
}
const modeIcons = {
  walk: FootprintsIcon,
  train: TrainIcon,
  bike: BikeIcon,
}

// Sort trips by arrival time
const sortedTrips = computed(() => {
  return [...trips].sort((a, b) => {
    const aEnd = getTripEndTime(a)
    const bEnd = getTripEndTime(b)
    return aEnd.getTime() - bEnd.getTime()
  })
})

// Calculate the latest end time among all trips
const endTime = computed(() => {
  return Math.max(...trips.map(trip => getTripEndTime(trip).getTime()))
})

// Generate time labels for the header (15-minute intervals)
const timeLabels = computed(() => {
  const labels = []
  let currentTime = dayjs(now).startOf('hour')
  const end = dayjs(endTime.value)

  while (currentTime.isBefore(end)) {
    labels.push(currentTime.format('H:mm'))
    currentTime = currentTime.add(15, 'minute')
  }
  return labels
})

function getRelativeTime(date: Date) {
  const minutes = dayjs(date).diff(now, 'minute')
  if (minutes <= 0) return 'Now'
  return `In ${minutes} min`
}

function getTripDuration(trip: Trip) {
  return trip.legs.reduce((acc, leg) => acc + leg.duration, 0)
}

function getTripEndTime(trip: Trip): Date {
  const lastLeg = trip.legs[trip.legs.length - 1]
  return dayjs(lastLeg.startTime).add(lastLeg.duration, 'minute').toDate()
}

// Add these new reactive variables
const containerRef = ref<HTMLElement | null>(null)
const isScrolledToEnd = ref(false)

// Add scroll handler function
function handleScroll() {
  if (!containerRef.value) return
  const container = containerRef.value
  const isAtEnd =
    container.scrollLeft + container.clientWidth >= container.scrollWidth - 1
  isScrolledToEnd.value = isAtEnd
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
  <div class="relative overflow-x-hidden max-h-[24rem]">
    <!-- Time labels -->
    <div class="flex relative mb-2">
      <div
        v-for="time in timeLabels"
        :key="time"
        class="flex-shrink-0 text-xs text-muted-foreground absolute ml-2"
        :style="{
          left: `${
            dayjs(
              dayjs(now)
                .startOf('hour')
                .add(timeLabels.indexOf(time) * 15, 'minute'),
            ).diff(now, 'minute') * pixelsPerMinute
          }px`,
        }"
      >
        {{ time }}
      </div>
    </div>

    <!-- Grid lines -->
    <div class="absolute inset-0 flex pointer-events-none">
      <div v-for="time in timeLabels" :key="time" class="flex-shrink-0">
        <div
          class="absolute top-0 h-full border-l border-border/75"
          :style="{
            left: `${
              dayjs(
                dayjs(now)
                  .startOf('hour')
                  .add(timeLabels.indexOf(time) * 15, 'minute'),
              ).diff(now, 'minute') * pixelsPerMinute
            }px`,
          }"
        />
      </div>
    </div>

    <div class="relative overflow-auto max-h-[24rem]" ref="containerRef">
      <!-- Timeline content -->
      <div class="relative flex flex-col pt-1 pb-3">
        <div v-for="(trip, tripIndex) in sortedTrips" :key="tripIndex">
          <Trip :trip="trip" :now="now" :pixels-per-minute="pixelsPerMinute" />
        </div>
      </div>
    </div>

    <!-- Updated scrim -->
    <div
      class="absolute right-0 top-0 bottom-0 w-20 pointer-events-none bg-gradient-to-l from-background to-transparent transition-opacity duration-200"
      :class="{ 'opacity-0': isScrolledToEnd }"
      :style="{
        right: `var(--removed-scroll-width, 0px)`,
        position: 'absolute',
      }"
    ></div>
  </div>
</template>
