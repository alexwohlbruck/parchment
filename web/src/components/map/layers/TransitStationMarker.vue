<script setup lang="ts">
import { computed } from 'vue'

interface Route {
  n: string // short name
  c: string // colour hex, no '#'
  t?: number // route_type
}

const props = withDefaults(
  defineProps<{
    name: string
    routes: Route[]
    /** Where the label block sits relative to the station point. */
    anchor?: 'right' | 'bottom'
    /** Whether to draw the name + bullet label (dot always shows). */
    showLabel?: boolean
  }>(),
  { anchor: 'right', showLabel: true },
)

/** White text on dark/saturated bullets, near-black on light ones (Apple). */
function textColor(hex: string): string {
  const h = (hex || '').replace('#', '')
  if (h.length < 6) return '#fff'
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.6 ? '#1a1a1a' : '#ffffff'
}

const bullets = computed(() =>
  props.routes.map((r) => ({
    n: r.n,
    bg: r.c ? `#${r.c}` : '#666',
    fg: textColor(r.c),
  })),
)

// Interchange (>1 route) = white dot with a dark ring; single route = the
// route's colour with a white ring (Apple).
const isInterchange = computed(() => props.routes.length > 1)
const dotStyle = computed(() => {
  if (isInterchange.value) return { background: '#ffffff' }
  const c = props.routes[0]?.c
  return { background: c ? `#${c}` : '#888' }
})
</script>

<template>
  <div class="station-origin">
    <div class="dot" :class="{ interchange: isInterchange }" :style="dotStyle"></div>
    <div v-if="showLabel" class="station-block" :class="`anchor-${anchor}`">
      <div class="name">{{ name }}</div>
      <div class="bullets">
        <span
          v-for="(b, i) in bullets"
          :key="b.n + i"
          class="bullet"
          :style="{ background: b.bg, color: b.fg }"
          >{{ b.n }}</span
        >
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Zero-size origin sitting exactly on the station point (maplibre/mapbox
   anchor the marker element at 'center'). */
.station-origin {
  position: relative;
  width: 0;
  height: 0;
  pointer-events: none;
  user-select: none;
  font-family:
    'DIN Pro', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
/* Custom station dot, centred on the point (replaces the baked circle layer). */
.dot {
  position: absolute;
  left: 0;
  top: 0;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  box-shadow:
    0 0 0 1.5px rgba(255, 255, 255, 0.95),
    0 0 2px rgba(0, 0, 0, 0.35);
}
.dot.interchange {
  width: 11px;
  height: 11px;
  box-shadow:
    0 0 0 2px rgba(60, 60, 66, 0.9),
    0 0 3px rgba(0, 0, 0, 0.3);
}
.station-block {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}
/* Block to the RIGHT of the point, vertically centred on the dot. */
.station-block.anchor-right {
  left: 10px;
  top: 0;
  transform: translateY(-50%);
}
/* Block BELOW the point, horizontally centred on the dot (fallback). */
.station-block.anchor-bottom {
  left: 0;
  top: 10px;
  transform: translateX(-50%);
}
.name {
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  color: #2a2a30;
  text-shadow:
    0 0 2px #fff,
    0 0 2px #fff,
    0 0 3px #fff;
}
:global(html.dark) .name {
  color: hsl(0, 0%, 90%);
  text-shadow:
    0 0 2px rgba(0, 0, 0, 0.9),
    0 0 2px rgba(0, 0, 0, 0.9),
    0 0 3px rgba(0, 0, 0, 0.85);
}
.bullets {
  display: flex;
  gap: 2px;
}
.bullet {
  width: 15px;
  height: 15px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  box-shadow: 0 0 0 1.5px rgba(255, 255, 255, 0.55);
}
</style>
