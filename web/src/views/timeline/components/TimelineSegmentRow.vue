<script setup lang="ts">
import { computed } from 'vue'
import {
  CarIcon,
  FootprintsIcon,
  BikeIcon,
  TrainIcon,
  AccessibilityIcon,
} from 'lucide-vue-next'
import { TravelMode } from '@server/types/unified-routing.types'
import { getTravelModeColor } from '@/lib/travel-mode-colors'
import type { LocationHistorySegment } from '@server/types/location-history.types'

const props = defineProps<{
  segment: LocationHistorySegment
}>()

const modeIcon = computed(() => {
  switch (props.segment.mode) {
    case TravelMode.DRIVING:
    case TravelMode.MOTORCYCLE:
    case TravelMode.TRUCK:
      return CarIcon
    case TravelMode.CYCLING:
      return BikeIcon
    case TravelMode.TRANSIT:
      return TrainIcon
    case TravelMode.WHEELCHAIR:
      return AccessibilityIcon
    case TravelMode.WALKING:
    default:
      return FootprintsIcon
  }
})

const modeColor = computed(() => getTravelModeColor(props.segment.mode))

const modeVerb = computed(() => {
  switch (props.segment.mode) {
    case TravelMode.DRIVING:
    case TravelMode.MOTORCYCLE:
    case TravelMode.TRUCK:
      return 'Drove'
    case TravelMode.CYCLING:
      return 'Cycled'
    case TravelMode.TRANSIT:
      return 'Transit'
    case TravelMode.WHEELCHAIR:
      return 'Traveled'
    case TravelMode.WALKING:
    default:
      return 'Walked'
  }
})

const timeLabel = computed(() => {
  const d = new Date(props.segment.startTime)
  const h = d.getHours()
  const m = d.getMinutes()
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`
})

const distanceLabel = computed(() => {
  const km = props.segment.distance / 1000
  if (km < 1) return `${Math.round(props.segment.distance)} m`
  return `${km.toFixed(km < 10 ? 1 : 0)} km`
})

const durationLabel = computed(() => {
  const totalMin = Math.max(1, Math.round(props.segment.duration / 60))
  if (totalMin < 60) return `${totalMin} min`
  const hours = Math.floor(totalMin / 60)
  const min = totalMin % 60
  return min === 0 ? `${hours}h` : `${hours}h ${min}m`
})

const title = computed(() => {
  if (props.segment.toStopId) {
    return `${modeVerb.value}`
  }
  return modeVerb.value
})
</script>

<template>
  <div class="tl-event" data-kind="travel">
    <div class="time">{{ timeLabel }}</div>
    <div class="title">{{ title }}</div>
    <div class="meta">
      <span class="meta-mode">
        <component
          :is="modeIcon"
          class="size-[11px]"
          :style="{ color: modeColor }"
        />
      </span>
      <span>{{ durationLabel }}</span>
      <span class="dot" />
      <span>{{ distanceLabel }}</span>
    </div>
  </div>
</template>
