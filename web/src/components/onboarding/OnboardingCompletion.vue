<script setup lang="ts">
import { computed, onMounted, onUnmounted, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMediaQuery } from '@vueuse/core'
import { useMapService } from '@/services/map/map.service'
import type { MapSnapshot } from '@/services/map/map-snapshot'
import { Spinner } from '@/components/ui/spinner'

const emit = defineEmits<{ reveal: []; complete: [] }>()
const { t } = useI18n()
const mapService = useMapService()
const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
const snapshot = shallowRef<MapSnapshot | null>(null)
const controller = new AbortController()
const timers: ReturnType<typeof setTimeout>[] = []
const duration = 1900
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
          <div v-for="panel in 3" :key="panel" class="map-panel" :class="`map-panel-${panel}`" />
        </div>
      </div>
      <div class="arrival-caption absolute inset-x-6 flex flex-col items-center gap-4 text-center">
        <Spinner v-if="!snapshot" class="size-5 text-muted-foreground" />
        <p class="text-balance font-display text-2xl">{{ snapshot ? t('onboarding.ready') : t('onboarding.openingMap') }}</p>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
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
  0%, 12% { transform: rotateY(82deg); }
  62%, 100% { transform: rotateY(0); }
}

@keyframes unfold-right {
  0%, 22% { transform: rotateY(-82deg); }
  70%, 100% { transform: rotateY(0); }
}

@keyframes unfold-viewport {
  0% { transform: translateY(24px) scale(0.42) rotateX(46deg) rotateY(-16deg) rotateZ(-18deg); opacity: 0; }
  10% { opacity: 1; }
  44% { transform: scale(0.58) rotateX(16deg) rotateY(-6deg) rotateZ(-6deg); }
  80%, 100% { transform: none; }
  88% { opacity: 1; }
  100% { opacity: 0; }
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
