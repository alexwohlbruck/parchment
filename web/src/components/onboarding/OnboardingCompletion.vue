<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMediaQuery } from '@vueuse/core'
import { useMapService } from '@/services/map/map.service'
import { LOGO_RATIO, PaperMapRenderer, foldedPacket } from './paper-map-renderer'
import ParchmentTile from './ParchmentTile.vue'

const props = defineProps<{ origin?: DOMRect | null }>()
const emit = defineEmits<{ reveal: []; complete: [] }>()
const { t } = useI18n()
const mapService = useMapService()
const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
const canvas = useTemplateRef<HTMLCanvasElement>('canvas')
const phase = ref<'waiting' | 'unfolding' | 'leaving'>('waiting')
const controller = new AbortController()
const timers: ReturnType<typeof setTimeout>[] = []
const fade = 450
const FLIGHT = 640
let renderer: PaperMapRenderer | null = null

const flight = computed(() => {
  const origin = props.origin
  if (!origin?.width) return null
  const packet = foldedPacket(window.innerWidth, window.innerHeight)
  return {
    '--from-x': `${origin.left}px`,
    '--from-y': `${origin.top}px`,
    '--from-size': `${origin.width}px`,
    '--from-logo': `${origin.width * LOGO_RATIO}px`,
    '--to-x': `${(window.innerWidth - packet.width) / 2}px`,
    '--to-y': `${(window.innerHeight - packet.height) / 2}px`,
    '--to-w': `${packet.width}px`,
    '--to-h': `${packet.height}px`,
    '--to-logo': `${Math.min(packet.width, packet.height) * LOGO_RATIO}px`,
  }
})
let mounted = false
let mountedAt = 0
let capturing = false
let completed = false

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
  if (controller.signal.aborted || !canvas.value) return
  try {
    renderer = await PaperMapRenderer.create(canvas.value, image, frame, document.documentElement.classList.contains('dark'))
  } catch {
    return complete()
  }
  if (flight.value) await new Promise(done => setTimeout(done, mountedAt + FLIGHT - performance.now()))
  if (controller.signal.aborted) return
  timers.forEach(clearTimeout)
  phase.value = 'unfolding'
  renderer.play()
  timers.push(setTimeout(() => { phase.value = 'leaving' }, renderer.duration))
  timers.push(setTimeout(complete, renderer.duration + fade))
}

onMounted(() => {
  mounted = true
  mountedAt = performance.now()
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
})
</script>

<template>
  <Teleport to="body">
    <div class="onboarding-arrival onboarding-backdrop fixed inset-0 z-40 bg-background" :class="`is-${phase}`" :style="{ '--fade': `${fade}ms` }" aria-hidden="true" />
    <div class="onboarding-arrival pointer-events-none fixed inset-0 z-[80] text-foreground" :class="`is-${phase}`" :style="{ '--fade': `${fade}ms` }" role="status" aria-live="polite" aria-atomic="true">
      <canvas ref="canvas" class="arrival-paper absolute inset-0 size-full" aria-hidden="true" />
      <ParchmentTile v-if="flight" class="brand-flight fixed" :style="{ ...flight, '--flight': `${FLIGHT}ms` }" aria-hidden="true" />
      <p class="arrival-caption absolute inset-x-6 text-balance text-center font-display text-2xl">{{ t('onboarding.ready') }}</p>
    </div>
  </Teleport>
</template>

<style scoped>
.onboarding-arrival { transition: opacity var(--fade) ease; }
.onboarding-arrival.is-leaving { opacity: 0; }

.arrival-paper { visibility: hidden; }
.is-unfolding .arrival-paper, .is-leaving .arrival-paper { visibility: visible; }

.brand-flight {
  left: var(--to-x);
  top: var(--to-y);
  width: var(--to-w);
  height: var(--to-h);
  border-radius: 2px;
  transform: rotate(-15deg);
  box-shadow: 0 6px 14px #1e140a47;
  animation: brand-flight var(--flight) cubic-bezier(0.65, 0, 0.3, 1) both;
}

.brand-flight::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: #ece4d4;
  animation: paper-tone var(--flight) ease-in both;
}

.brand-flight :deep(svg) {
  position: relative;
  z-index: 1;
  width: var(--to-logo);
  height: var(--to-logo);
  animation: logo-size var(--flight) cubic-bezier(0.65, 0, 0.3, 1) both;
}

.is-unfolding .brand-flight, .is-leaving .brand-flight { visibility: hidden; }

@keyframes brand-flight {
  from {
    left: var(--from-x);
    top: var(--from-y);
    width: var(--from-size);
    height: var(--from-size);
    border-radius: 16px;
    transform: rotate(9deg);
    box-shadow: 0 6px 16px -6px #2a1d0e40;
  }
  50% { transform: rotate(-4deg) scale(1.06); box-shadow: 0 18px 30px -8px #1e140a55; }
}

@keyframes paper-tone {
  from { opacity: 0; }
}

@keyframes logo-size {
  from { width: var(--from-logo); height: var(--from-logo); }
}

.arrival-caption {
  bottom: max(10vh, 40px);
  animation: arrival-caption 600ms 150ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
  text-shadow: 0 1px 12px var(--background);
}

@keyframes arrival-caption {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: none; }
}

@media (prefers-reduced-motion: reduce) {
  .arrival-caption { animation: none; }
}
</style>
