<script setup lang="ts">
import { computed } from 'vue'
import dayjs from 'dayjs'
import { FootprintsIcon, TrainIcon, BikeIcon } from 'lucide-vue-next'

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
        duration: 2,
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
const modeColors = {
  walk: 'bg-blue-300 dark:bg-blue-500',
  train: 'bg-green-300 dark:bg-green-500',
  bike: 'bg-indigo-300 dark:bg-indigo-500',
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
  if (minutes <= 0) return 'Go now'
  return `Go in ${minutes} min`
}

function getTripDuration(trip: Trip) {
  return trip.legs.reduce((acc, leg) => acc + leg.duration, 0)
}

function getTripEndTime(trip: Trip): Date {
  const lastLeg = trip.legs[trip.legs.length - 1]
  return dayjs(lastLeg.startTime).add(lastLeg.duration, 'minute').toDate()
}
</script>

<template>
  <div class="relative overflow-auto max-h-[24rem]">
    <div
      class="sticky top-0 flex bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
    >
      <div class="flex">
        <div
          v-for="time in timeLabels"
          :key="time"
          class="flex-shrink-0 w-[60px] text-xs text-muted-foreground"
        >
          {{ time }}
        </div>
      </div>
    </div>

    <div class="relative flex flex-col gap-6 pt-1 pb-3">
      <div
        v-for="(trip, tripIndex) in sortedTrips"
        :key="tripIndex"
        class="flex items-center min-h-[48px] hover:bg-muted/50 py-2"
      >
        <div class="flex items-center relative">
          <div
            v-for="(leg, legIndex) in trip.legs"
            :key="legIndex"
            class="flex flex-col items-center"
            :style="{
              marginLeft:
                legIndex === 0
                  ? `${
                      dayjs(leg.startTime).diff(now, 'minute') * pixelsPerMinute
                    }px`
                  : 0,
            }"
          >
            <div class="relative">
              <div
                :class="[modeColors[leg.mode]]"
                class="h-8 rounded flex items-center justify-center relative group border border-border"
                :style="{
                  width: `${leg.duration * pixelsPerMinute}px`,
                }"
              >
                <component
                  :is="modeIcons[leg.mode]"
                  class="size-4 text-black"
                />
              </div>

              <div
                v-if="legIndex === 0"
                class="absolute left-0 top-full text-xs text-muted-foreground mt-1 whitespace-nowrap"
              >
                {{ getRelativeTime(leg.startTime) }}
              </div>

              <div
                v-if="legIndex === trip.legs.length - 1"
                class="absolute right-0 top-full text-xs text-muted-foreground mt-1 whitespace-nowrap"
              >
                {{ getTripDuration(trip) }} min
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div
      class="absolute right-0 top-0 bottom-0 w-16 pointer-events-none bg-gradient-to-l from-background to-transparent"
      style="right: var(--removed-scroll-width, 0px)"
    ></div>
  </div>
</template>
