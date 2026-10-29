<script setup lang="ts">
import { onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import { useMapService } from '@/services/map/map.service'
import { PaperMapRenderer, type PaperRect } from './paper-map-renderer'

const props = defineProps<{ origin?: PaperRect | null; face?: HTMLCanvasElement | null }>()
const emit = defineEmits<{ reveal: []; start: []; complete: [] }>()
const mapService = useMapService()
const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
const canvas = useTemplateRef<HTMLCanvasElement>('canvas')
const phase = ref<'waiting' | 'unfolding' | 'landed' | 'leaving'>('waiting')
const controller = new AbortController()
const timers: ReturnType<typeof setTimeout>[] = []
const fade = 350
const unfoldDuration = ref(0)
let renderer: PaperMapRenderer | null = null
let mounted = false
let capturing = false
let completed = false

function showLiveMap() {
  document.documentElement.classList.remove('paper-unfolding')
}

function complete() {
  if (completed) return
  completed = true
  showLiveMap()
  timers.forEach(clearTimeout)
  controller.abort()
  emit('start')
  emit('complete')
}

async function capture() {
  if (!mounted || capturing || completed || !mapService.isMapReady.value) return
  capturing = true
  const frame = await mapService.captureSnapshot(controller.signal)
  if (controller.signal.aborted) return
  if (!frame || !canvas.value) return complete()

  const origin = props.origin?.width ? props.origin : { left: frame.left + frame.width / 2 - 120, top: frame.top + frame.height / 2 - 160, width: 240, height: 320 }
  try {
    renderer = await PaperMapRenderer.create(canvas.value, frame.image, frame, origin, props.origin?.width ? props.face ?? null : null, document.documentElement.classList.contains('dark'))
  } catch {
    return complete()
  }
  if (controller.signal.aborted) return
  timers.forEach(clearTimeout)
  renderer.play()
  unfoldDuration.value = renderer.duration
  phase.value = 'unfolding'
  emit('start')
  document.documentElement.classList.add('paper-unfolding')
  timers.push(setTimeout(() => { phase.value = 'landed' }, renderer.revealAt))
  timers.push(setTimeout(showLiveMap, renderer.duration))
  timers.push(setTimeout(() => { phase.value = 'leaving' }, renderer.duration))
  timers.push(setTimeout(complete, renderer.duration + fade))
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
  renderer?.destroy()
  showLiveMap()
})
</script>

<template>
  <Teleport to="body">
    <div class="onboarding-arrival pointer-events-none fixed inset-0 z-40 overflow-hidden" :class="`is-${phase}`" :style="{ '--fade': `${fade}ms`, '--unfold': `${unfoldDuration}ms` }" aria-hidden="true">
      <div class="arrival-backdrop onboarding-backdrop absolute inset-0 bg-background">
        <span class="blob blob-primary" />
        <span class="blob blob-cream" />
        <span class="blob blob-tan" />
      </div>
      <canvas ref="canvas" class="absolute inset-0 size-full" />
    </div>
  </Teleport>
</template>

<style scoped>
.onboarding-arrival { transition: opacity var(--fade) ease; }
.onboarding-arrival.is-leaving { opacity: 0; }
.arrival-backdrop { transition: opacity 900ms ease; }
.is-landed .arrival-backdrop, .is-leaving .arrival-backdrop { opacity: 0; }

.blob {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 60vmax;
  height: 60vmax;
  border-radius: 9999px;
  filter: blur(90px);
  opacity: 0;
  transform: translate(-50%, -50%) scale(0.1);
}

.blob-primary { background: hsl(var(--primary) / 0.35); }
.blob-cream { background: #f3e6c866; --x: -18vmax; --y: 10vmax; --r: -40deg; }
.blob-tan { background: #c9a97a55; --x: 20vmax; --y: -12vmax; --r: 50deg; }

.is-unfolding .blob, .is-landed .blob, .is-leaving .blob { animation: blob-bloom calc(var(--unfold) * 0.9) cubic-bezier(0.2, 0.7, 0.2, 1) both; }
.blob-cream { animation-delay: 120ms !important; }
.blob-tan { animation-delay: 240ms !important; }

@keyframes blob-bloom {
  0% { opacity: 0; transform: translate(-50%, -50%) scale(0.1) rotate(0deg); }
  35% { opacity: 0.7; }
  100% {
    opacity: 0.55;
    transform: translate(calc(-50% + var(--x, 0px)), calc(-50% + var(--y, 0px))) scale(2.2) rotate(var(--r, 0deg));
  }
}

@media (prefers-reduced-motion: reduce) {
  .blob { animation: none; }
}
</style>

<style>
.paper-unfolding :is(.maplibregl-canvas-container, .mapboxgl-canvas-container) { visibility: hidden; }
</style>
