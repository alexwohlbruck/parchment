<script setup lang="ts">
interface Props {
  accuracy: number | null
  heading: number | null
  mode?: 'dot' | 'navigation'
}

const props = withDefaults(defineProps<Props>(), {
  mode: 'dot',
})
</script>

<template>
  <div
    class="user-location-marker"
    :class="{ 'navigation-mode': props.mode === 'navigation' }"
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

    <!-- Navigation arrow (navigation mode) -->
    <div
      v-if="props.mode === 'navigation'"
      class="navigation-arrow"
      :style="{ transform: `rotate(${props.heading ?? 0}deg)` }"
    >
      <svg
        width="40"
        height="40"
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <!-- Directional chevron / arrow -->
        <path
          d="M20 4L32 28L20 22L8 28L20 4Z"
          fill="hsl(var(--primary))"
          stroke="white"
          stroke-width="2"
          stroke-linejoin="round"
        />
      </svg>
    </div>
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
  /* Anchor the cone's apex (bottom-centre of the SVG) at the dot centre. */
  transform: translate(-50%, -100%);
  z-index: 0;
  /* Softens the cone edges into a diffuse beam. */
  filter: blur(2px);
  /* Toggled by the layer via setMarkerHeading; hidden until a heading is
     known. No transition so recreating the marker never re-fades the beam. */
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

.navigation-arrow {
  z-index: 2;
  transition: transform 0.3s ease;
  filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.3));
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
