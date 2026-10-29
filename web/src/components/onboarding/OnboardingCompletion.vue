<script setup lang="ts">
import { onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMediaQuery } from '@vueuse/core'
import { useMapService } from '@/services/map/map.service'
import { playUnfoldSound } from '@/lib/onboarding/unfold-sound'
import { PaperMapRenderer, type PaperRect } from './paper-map-renderer'

const props = defineProps<{ origin?: PaperRect | null; face?: HTMLCanvasElement | null }>()
const emit = defineEmits<{ reveal: []; start: []; complete: [] }>()
const { t } = useI18n()
const mapService = useMapService()
const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
const canvas = useTemplateRef<HTMLCanvasElement>('canvas')
const phase = ref<'waiting' | 'unfolding' | 'leaving'>('waiting')
const controller = new AbortController()
const timers: ReturnType<typeof setTimeout>[] = []
const fade = 600
const HOLD = 1100
const unfoldDuration = ref(0)
let stopSound = () => {}
let renderer: PaperMapRenderer | null = null
let mounted = false
let capturing = false
let completed = false

function complete() {
  if (completed) return
  completed = true
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
  stopSound = playUnfoldSound(renderer.beats, renderer.duration)
  unfoldDuration.value = renderer.duration
  phase.value = 'unfolding'
  emit('start')
  timers.push(setTimeout(() => { phase.value = 'leaving' }, renderer.duration + HOLD))
  timers.push(setTimeout(complete, renderer.duration + HOLD + fade))
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
  stopSound()
})
</script>

<template>
  <Teleport to="body">
    <div class="onboarding-arrival onboarding-backdrop fixed inset-0 z-40 overflow-hidden bg-background" :class="`is-${phase}`" :style="{ '--fade': `${fade}ms`, '--unfold': `${unfoldDuration}ms` }" aria-hidden="true">
      <div class="arrival-blobs absolute inset-0">
        <span class="blob blob-primary" />
        <span class="blob blob-warm" />
        <span class="blob blob-cool" />
      </div>
      <canvas ref="canvas" class="absolute inset-0 size-full" />
    </div>
    <div class="onboarding-arrival pointer-events-none fixed inset-0 z-[80] flex items-end justify-center text-foreground" :class="`is-${phase}`" :style="{ '--fade': `${fade}ms`, '--unfold': `${unfoldDuration}ms` }" role="status" aria-live="polite" aria-atomic="true">
      <div v-if="phase !== 'waiting'" class="arrival-caption relative mb-[max(12vh,56px)] px-6 text-center">
        <span class="caption-glow absolute inset-0 -z-10" aria-hidden="true" />
        <p class="text-balance font-display text-4xl font-semibold tracking-tight sm:text-6xl">{{ t('onboarding.ready') }}</p>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.onboarding-arrival { transition: opacity var(--fade) ease; }
.onboarding-arrival.is-leaving { opacity: 0; }

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

.blob-primary { background: hsl(var(--primary) / 0.7); }
.blob-warm { background: #f5b75a99; --x: -18vmax; --y: 10vmax; --r: -40deg; }
.blob-cool { background: #6aa8ff88; --x: 20vmax; --y: -12vmax; --r: 50deg; }

.is-unfolding .blob, .is-leaving .blob { animation: blob-bloom calc(var(--unfold) * 0.9) cubic-bezier(0.2, 0.7, 0.2, 1) both; }
.is-unfolding .blob-warm, .is-leaving .blob-warm { animation-delay: 120ms; }
.is-unfolding .blob-cool, .is-leaving .blob-cool { animation-delay: 240ms; }

@keyframes blob-bloom {
  0% { opacity: 0; transform: translate(-50%, -50%) scale(0.1) rotate(0deg); }
  35% { opacity: 1; }
  100% {
    opacity: 0.8;
    transform: translate(calc(-50% + var(--x, 0px)), calc(-50% + var(--y, 0px))) scale(2.2) rotate(var(--r, 0deg));
  }
}

.arrival-caption {
  animation: caption-in 900ms calc(var(--unfold) * 0.55) cubic-bezier(0.2, 0.7, 0.2, 1) both;
}

.caption-glow {
  inset: -40% -15%;
  background: radial-gradient(closest-side, hsl(var(--background) / 0.85), hsl(var(--background) / 0));
  filter: blur(12px);
}

@keyframes caption-in {
  from { opacity: 0; filter: blur(14px); transform: translateY(14px) scale(0.97); letter-spacing: 0.04em; }
  to { opacity: 1; filter: blur(0); transform: none; }
}

@media (prefers-reduced-motion: reduce) {
  .arrival-caption, .blob { animation: none; }
}
</style>
