<script setup lang="ts">
import { computed, onMounted, onUnmounted, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMediaQuery } from '@vueuse/core'
import { useMapService } from '@/services/map/map.service'
import type { MapSnapshot } from '@/services/map/map-snapshot'
import ParchmentLogo from '@/assets/parchment.svg?component'

const emit = defineEmits<{ reveal: []; complete: [] }>()
const { t } = useI18n()
const mapService = useMapService()
const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
const snapshot = shallowRef<MapSnapshot | null>(null)
const controller = new AbortController()
const timers: ReturnType<typeof setTimeout>[] = []
const duration = 2400
let mounted = false
let capturing = false
let completed = false

const paperStyle = computed(() => snapshot.value ? {
  left: `${snapshot.value.left}px`,
  top: `${snapshot.value.top}px`,
  width: `${snapshot.value.width}px`,
  height: `${snapshot.value.height}px`,
  '--map-image': `url("${snapshot.value.image}")`,
} : {})

function complete() {
  if (completed) return
  completed = true
  timers.forEach(clearTimeout)
  controller.abort()
  emit('complete')
}

async function capture() {
  if (!mounted || capturing || completed || !mapService.isMapReady.value) return
  capturing = true
  const frame = await mapService.captureSnapshot(controller.signal)
  if (controller.signal.aborted) return
  if (!frame) return complete()

  const image = new Image()
  image.src = frame.image
  try {
    await image.decode()
  } catch {
    return complete()
  }
  if (controller.signal.aborted) return
  timers.forEach(clearTimeout)
  snapshot.value = frame
  timers.push(setTimeout(complete, duration))
}

onMounted(() => {
  mounted = true
  window.addEventListener('resize', complete)
  emit('reveal')
  if (reducedMotion.value) return complete()
  timers.push(setTimeout(complete, 3500))
  capture()
})

watch(mapService.isMapReady, ready => {
  if (ready) capture()
})
watch(reducedMotion, reduced => {
  if (reduced) complete()
})

onUnmounted(() => {
  window.removeEventListener('resize', complete)
  timers.forEach(clearTimeout)
  controller.abort()
})
</script>

<template>
  <Teleport to="body">
    <div class="onboarding-arrival fixed inset-0 z-[80] text-foreground" :class="{ 'is-unfolding': snapshot }" :style="{ '--unfold-duration': `${duration}ms` }" role="status" aria-live="polite" aria-atomic="true">
      <div class="arrival-backdrop absolute inset-0 bg-background" aria-hidden="true" />
      <div v-if="snapshot" class="paper-stage absolute inset-0" aria-hidden="true">
        <div class="paper-map" :style="paperStyle">
          <div v-for="panel in 3" :key="panel" class="map-panel" :class="`map-panel-${panel}`">
            <div class="paper-face">
              <svg :viewBox="`${(panel - 1) * 100} 0 100 210`" preserveAspectRatio="none" class="paper-chart">
                <path class="chart-coast" d="M-10 30Q20 5 48 28T90 45L104 79 84 113 45 121 28 159-10 169ZM206-10 196 29 225 62 217 95 255 111 310 83V-10ZM181 162 205 140 238 150 250 185 226 220H167Z" />
                <path class="chart-contour" d="M-10 42Q20 17 44 39T78 56L91 78 72 101 37 109 15 148M216-10 208 24 237 58 229 88 257 99 310 71M193 169 209 153 229 161 237 182 218 207" />
                <path class="chart-trail" d="M33 146C53 157 81 134 77 111S106 69 137 85 170 132 195 110 246 102 263 77" />
                <path class="chart-cross" d="m258 72 10 10m0-10-10 10" />
                <g class="chart-compass" transform="translate(249 38)">
                  <circle r="17" /><circle r="12" />
                  <path d="M0-24 5-5 24 0 5 5 0 24-5 5-24 0-5-5Z" />
                  <path d="M0-16V16M-16 0H16" />
                </g>
              </svg>
              <div v-if="panel === 2" class="paper-seal"><ParchmentLogo /></div>
            </div>
          </div>
        </div>
      </div>
      <div class="arrival-caption absolute inset-x-6 flex flex-col items-center gap-4 text-center">
        <ParchmentLogo class="arrival-logo size-9" aria-hidden="true" />
        <span class="font-display text-3xl">Parchment</span>
        <p class="text-balance text-sm opacity-70">{{ snapshot ? t('onboarding.ready') : t('onboarding.openingMap') }}</p>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.onboarding-arrival {
  --paper: #ecd7ac;
  --ink: #73562f;
  color: var(--ink);
}

.arrival-backdrop {
  background: radial-gradient(ellipse at 50% 40%, #f5ead5, #e7d4b0);
}

.paper-stage {
  perspective: 1400px;
  perspective-origin: 50% 40%;
}

.paper-map {
  position: absolute;
  display: flex;
  transform-origin: center;
  transform-style: preserve-3d;
  animation: unfold-viewport var(--unfold-duration) cubic-bezier(0.22, 0.65, 0.25, 1) both;
}

.map-panel {
  position: relative;
  flex: 0 0 calc(100% / 3);
  height: 100%;
  background-image: var(--map-image);
  background-size: 300% 100%;
  backface-visibility: hidden;
}

.paper-face {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: radial-gradient(ellipse at 35% 35%, #f7e9ca, transparent 75%),
    repeating-linear-gradient(4deg, #73562f06 0 1px, transparent 1px 4px), var(--paper);
  box-shadow: inset 0 0 24px #92642b38;
  animation: paper-to-map var(--unfold-duration) ease both;
}

.paper-chart {
  width: 100%;
  height: 100%;
  fill: none;
  stroke: var(--ink);
  stroke-width: 0.7;
}

.chart-coast { fill: #bca36c30; }
.chart-contour { opacity: 0.3; }
.chart-trail { stroke-dasharray: 2 3; stroke-width: 1; }
.chart-cross { stroke-width: 1.5; }
.chart-compass { stroke-width: 0.6; }

.paper-seal {
  position: absolute;
  inset: 42% 16%;
  display: grid;
  place-items: center;
  background: #efddb9;
  border: 1px solid #73562f60;
  border-radius: 50%;
  aspect-ratio: 1;
  height: auto;
}

.paper-seal svg { width: 75%; }

.map-panel::after {
  content: '';
  position: absolute;
  inset: 0;
  box-shadow: inset 0 0 0 1px hsl(var(--foreground) / 0.15), 0 20px 50px -12px rgb(0 0 0 / 0.3);
  background: linear-gradient(90deg, rgb(0 0 0 / 0.18), transparent 35%, rgb(255 255 255 / 0.1));
  animation: paper-shading var(--unfold-duration) ease both;
}

.map-panel-1 {
  background-position: left center;
  transform-origin: right center;
  animation: unfold-left var(--unfold-duration) cubic-bezier(0.4, 0, 0.2, 1) both;
}

.map-panel-2 {
  background-position: center;
}

.map-panel-3 {
  background-position: right center;
  transform-origin: left center;
  animation: unfold-right var(--unfold-duration) cubic-bezier(0.4, 0, 0.2, 1) both;
}

.arrival-caption {
  bottom: max(9vh, 32px);
}

.is-unfolding .arrival-caption {
  animation: arrival-caption var(--unfold-duration) ease both;
}

.is-unfolding .arrival-backdrop {
  animation: reveal-live-map var(--unfold-duration) ease both;
}

@keyframes unfold-left {
  0%, 16% { transform: rotateY(82deg); }
  62%, 100% { transform: rotateY(0); }
}

@keyframes unfold-right {
  0%, 24% { transform: rotateY(-82deg); }
  70%, 100% { transform: rotateY(0); }
}

@keyframes unfold-viewport {
  0% { transform: translateY(24px) scale(0.75, 0.26) rotateX(46deg) rotateY(-16deg) rotateZ(-18deg); opacity: 0; }
  10% { opacity: 1; }
  44% { transform: scale(0.85, 0.4) rotateX(16deg) rotateY(-6deg) rotateZ(-6deg); }
  80%, 100% { transform: none; }
  88% { opacity: 1; }
  100% { opacity: 0; }
}

@keyframes paper-to-map {
  0%, 38% { opacity: 1; }
  72%, 100% { opacity: 0; }
}

@keyframes paper-shading {
  0%, 30% { opacity: 1; }
  80%, 100% { opacity: 0; }
}

@keyframes reveal-live-map {
  0%, 42% { opacity: 1; }
  78%, 100% { opacity: 0; }
}

@keyframes arrival-caption {
  0%, 30% { opacity: 1; transform: translateY(0); }
  60%, 100% { opacity: 0; transform: translateY(-6px); }
}

@media (prefers-reduced-motion: reduce) {
  .onboarding-arrival *, .onboarding-arrival *::after {
    animation: none;
  }
}
</style>
