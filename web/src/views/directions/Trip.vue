<script setup lang="ts">
import { FootprintsIcon, TrainIcon, BikeIcon } from 'lucide-vue-next'
import dayjs from 'dayjs'

interface TripLeg {
  mode: 'walk' | 'train' | 'bike'
  duration: number // in minutes
  startTime: Date
}

interface Trip {
  legs: TripLeg[]
}

const props = defineProps<{
  trip: Trip
  now?: Date
  pixelsPerMinute?: number
}>()

const now = props.now || new Date()
const pixelsPerMinute = props.pixelsPerMinute || 10
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

function getRelativeTime(date: Date) {
  const minutes = dayjs(date).diff(now, 'minute')
  if (minutes <= 0) return 'Now'
  return `In ${minutes} min`
}

function getTripDuration(trip: Trip) {
  return trip.legs.reduce((acc, leg) => acc + leg.duration, 0)
}
</script>

<template>
  <div class="flex items-center min-h-[48px] hover:bg-muted/50 py-2">
    <div class="flex relative">
      <div
        v-for="(leg, legIndex) in trip.legs"
        :key="legIndex"
        class="flex flex-col"
        :style="{
          marginLeft:
            legIndex === 0
              ? `${
                  dayjs(leg.startTime).diff(now, 'minute') * pixelsPerMinute
                }px`
              : `${legGapPixels}px`,
        }"
      >
        <div>
          <div
            :class="[modeColors[leg.mode]]"
            class="h-8 px-1 rounded flex items-center justify-center relative group shadow-lg"
            :style="{
              width: `${
                leg.duration * pixelsPerMinute -
                (legIndex < trip.legs.length - 1 ? legGapPixels : 0)
              }px`,
            }"
          >
            <component :is="modeIcons[leg.mode]" class="size-4 text-black" />
          </div>

          <div>
            <div
              v-if="legIndex === 0"
              class="absolute top-full text-xs text-muted-foreground mt-1 whitespace-nowrap"
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
</template>
