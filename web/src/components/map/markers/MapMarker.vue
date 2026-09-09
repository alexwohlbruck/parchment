<script setup lang="ts">
/**
 * A marker in the DOM: the plate, what sits on it, and the states a live one
 * takes — all drawn from `lib/map-marker`.
 *
 * Vue markers each used to draw their own circle in a `<style scoped>` block:
 * the tracker a 28px `--foreground` disc under a 2.5px white ring, the friend a
 * 36px avatar under a 3px one, the parked-vehicle one a 32px outline with a
 * stem, each with its own copy of the same pulse keyframes. They are the same
 * mark, and how big it is and what colour it takes belong to `map-marker`
 * rather than to a copy per feature.
 *
 * Wrap this rather than extend it: a marker still owns its own tooltip, its
 * click handling and what it puts on the plate.
 */

import { computed } from 'vue'
import {
  markerCss,
  MARKER_PLATE_SIZE,
  type MarkerPaint,
  type MarkerShape,
} from '@/lib/map-marker'

const {
  paint,
  shape = 'disc',
  size = MARKER_PLATE_SIZE,
  hovered = false,
  pulse = false,
  muted = false,
  fill = false,
} = defineProps<{
  /** Plate, glyph and ring colours — from `markerPaint` or a category. */
  paint: MarkerPaint
  shape?: MarkerShape
  /** Plate width. Live markers pass `MARKER_LIVE_PLATE_SIZE`. */
  size?: number
  hovered?: boolean
  /** Ring pulsing out from behind the plate — "this is where it is now". */
  pulse?: boolean
  /** Dimmed, and never pulsing: the position is old enough to distrust. */
  muted?: boolean
  /** Content spans the plate rather than sitting on it, for a face. */
  fill?: boolean
}>()

const css = computed(() => markerCss(paint, shape, size))

// Sized off the plate so the pulse stays in proportion whatever the plate is,
// and coloured with the glyph rather than the plate: the plate is pale by day
// and deep at night, so it disappears into one map or the other.
const pulseStyle = computed(() => ({
  width: `${size * 1.6}px`,
  height: `${size * 1.6}px`,
  backgroundColor: paint.ink,
}))

const contentStyle = computed(() =>
  fill
    ? {
        width: '100%',
        height: '100%',
        borderRadius: 'inherit',
        overflow: 'hidden',
        color: paint.ink,
      }
    : css.value.glyph,
)
</script>

<template>
  <div
    class="relative flex items-center justify-center select-none"
    :class="{ 'opacity-80': muted }"
  >
    <div v-if="pulse && !muted" class="map-marker-pulse" :style="pulseStyle" />

    <div
      class="relative shadow-md transition-transform duration-150 ease-out"
      :class="{ 'scale-[1.15]': hovered }"
      :style="css.plate"
    >
      <div class="flex items-center justify-center [&>svg]:size-full" :style="contentStyle">
        <slot />
      </div>

      <!-- Corner accessory — an online dot, a resolved check. Positioned by
           the marker that provides it, against the plate. -->
      <slot name="badge" />
    </div>
  </div>
</template>

<style scoped>
.map-marker-pulse {
  position: absolute;
  top: 50%;
  left: 50%;
  border-radius: 9999px;
  animation: map-marker-pulse 2.5s ease-out infinite;
}

@keyframes map-marker-pulse {
  0% {
    transform: translate(-50%, -50%) scale(0.9);
    opacity: 0.35;
  }
  70%,
  100% {
    transform: translate(-50%, -50%) scale(1.8);
    opacity: 0;
  }
}
</style>
