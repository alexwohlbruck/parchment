<script setup lang="ts">
import { computed } from 'vue'
import { DEFAULT_VEHICLE_COLOR, inkOn } from '@/lib/guidance/vehicle-indicator'

interface Props {
  accuracy: number | null
  heading: number | null
  mode?: 'dot' | 'navigation'
  color?: string
}

const props = withDefaults(defineProps<Props>(), {
  mode: 'dot',
  color: DEFAULT_VEHICLE_COLOR,
})
const emit = defineEmits<{ select: [] }>()

const ink = computed(() => inkOn(props.color))
</script>

<template>
  <div
    class="user-location-marker"
    :class="{ 'navigation-mode': props.mode === 'navigation' }"
    @click="props.mode === 'dot' && emit('select')"
  >
    <!--
      Compass direction beam (dot mode). Points "up" in the marker's local
      frame; the map layer rotates the whole marker to the device heading via
      MapLibre `setRotation` (rotationAlignment 'map'), so it stays
      north-relative as the map turns. Hidden until a heading is available,
      toggled by the `--heading-opacity` custom property the layer sets.
    -->
    <div v-if="props.mode === 'dot'" class="heading-beam">
      <svg width="72" height="72" viewBox="0 0 72 72" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="user-heading-beam" cx="50%" cy="100%" r="100%">
            <stop offset="0%" stop-color="hsl(var(--primary))" stop-opacity="0.5" />
            <stop offset="55%" stop-color="hsl(var(--primary))" stop-opacity="0.18" />
            <stop offset="100%" stop-color="hsl(var(--primary))" stop-opacity="0" />
          </radialGradient>
        </defs>
        <!-- Cone with its apex at the dot centre (36,72), fanning upward. -->
        <path d="M36 72 L6 12 Q36 2 66 12 Z" fill="url(#user-heading-beam)" />
      </svg>
    </div>

    <!-- Accuracy pulse ring (dot mode only) -->
    <div v-if="props.mode === 'dot'" class="accuracy-ring" />

    <!-- Blue dot (dot mode) -->
    <div v-if="props.mode === 'dot'" class="location-dot" />

    <!-- Rotated and laid on the map by the layer; fades to a dot while the heading is unknown. -->
    <template v-if="props.mode === 'navigation'">
      <svg class="navigation-arrow" width="46" height="46" viewBox="0 0 46 46" xmlns="http://www.w3.org/2000/svg">
        <circle cx="23" cy="23" r="20" fill="white" />
        <circle cx="23" cy="23" r="16.5" :fill="props.color" />
        <path d="M23 10.5L31.5 32L23 27.2L14.5 32Z" :fill="ink" stroke-linejoin="round" :stroke="ink" stroke-width="1.5" />
      </svg>
      <div class="navigation-dot" :style="{ background: props.color }" />
    </template>
  </div>
</template>

<style scoped>
.user-location-marker {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
}

.user-location-marker:not(.navigation-mode) {
  cursor: pointer;
}

.location-dot {
  position: relative;
  z-index: 2;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: hsl(var(--primary));
  border: 2.5px solid white;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  transition: transform 0.3s ease;
}

.heading-beam {
  position: absolute;
  left: 50%;
  top: 50%;
  /* Anchor the cone's apex (bottom-centre of the SVG) at the dot centre, then
     scale horizontally by the layer-provided spread (wider = less certain
     heading). scaleX pivots on the centreline, which passes through the apex,
     so the cone stays anchored. */
  transform: translate(-50%, -100%) scaleX(var(--beam-spread, 1));
  /* Ease width changes as compass accuracy improves/degrades. */
  transition: transform 0.3s ease;
  z-index: 0;
  /* Softens the cone edges into a diffuse beam. */
  filter: blur(2px);
  /* Toggled by the layer via setMarkerHeading; hidden until a heading is
     known. No opacity transition so recreating the marker never re-fades. */
  opacity: var(--heading-opacity, 0);
  pointer-events: none;
}

.accuracy-ring {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: hsl(var(--primary) / 0.2);
  animation: pulse 2.5s ease-out infinite;
  z-index: 1;
}

.navigation-arrow,
.navigation-dot {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 2;
  transition: opacity 0.3s ease;
}

.navigation-arrow {
  filter: drop-shadow(0 3px 5px rgba(0, 0, 0, 0.3));
  opacity: var(--heading-opacity, 1);
}

.navigation-dot {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 3px solid white;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.3);
  opacity: calc(1 - var(--heading-opacity, 1));
}

@keyframes pulse {
  0% {
    transform: translate(-50%, -50%) scale(0.8);
    opacity: 0.6;
  }
  70% {
    transform: translate(-50%, -50%) scale(1.6);
    opacity: 0;
  }
  100% {
    transform: translate(-50%, -50%) scale(1.6);
    opacity: 0;
  }
}
</style>
