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
  return min === 0 ? `${hours} hr` : `${hours} hr ${min} min`
})
</script>

<template>
  <div class="relative flex items-center gap-2.5 px-3 py-1.5 text-xs">
    <!-- Mode-coloured thread that runs full row height, aligned with the
         centre of neighbouring stop ItemIcons. Continuous with the muted
         thread on stop rows so the whole list reads as one timeline. -->
    <div
      aria-hidden="true"
      class="absolute top-0 bottom-0 w-[3px] rounded-full left-[28px] -translate-x-1/2"
      :style="{ backgroundColor: modeColor }"
    />
    <!-- Spacer reserves the icon column so text aligns with stop rows. -->
    <div class="w-8 shrink-0" />
    <component
      :is="modeIcon"
      class="relative z-10 w-3.5 h-3.5 shrink-0"
      :style="{ color: modeColor }"
    />
    <span class="text-muted-foreground tabular-nums">{{ distanceLabel }}</span>
    <span class="text-muted-foreground/40">·</span>
    <span class="text-muted-foreground tabular-nums">{{ durationLabel }}</span>
  </div>
</template>
