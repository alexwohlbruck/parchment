<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMediaQuery } from '@vueuse/core'
import { useMapService } from '@/services/map/map.service'
import { PaperMapRenderer, packetSize } from './paper-map-renderer'
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
let renderer: PaperMapRenderer | null = null
const flying = ref(false)

const flight = computed(() => {
  const origin = props.origin
  if (!origin?.width) return null
  const size = packetSize(window.innerWidth, window.innerHeight)
  return {
    left: `${origin.left}px`,
    top: `${origin.top}px`,
    width: `${origin.width}px`,
    height: `${origin.height}px`,
    '--dx': `${window.innerWidth / 2 - origin.left - origin.width / 2}px`,
    '--dy': `${window.innerHeight / 2 - origin.top - origin.height / 2}px`,
    '--scale': size / origin.width,
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
  if (flight.value) await new Promise(done => setTimeout(done, mountedAt + 760 - performance.now()))
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
  requestAnimationFrame(() => requestAnimationFrame(() => { flying.value = true }))
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
    <div class="onboarding-arrival fixed inset-0 z-[80] text-foreground" :class="`is-${phase}`" :style="{ '--fade': `${fade}ms` }" role="status" aria-live="polite" aria-atomic="true">
      <div class="onboarding-backdrop absolute inset-0 bg-background" aria-hidden="true" />
      <canvas ref="canvas" class="arrival-paper absolute inset-0 size-full" aria-hidden="true" />
      <ParchmentTile v-if="flight" class="brand-flight fixed" :class="{ 'is-flying': flying }" :style="flight" aria-hidden="true" />
      <p class="arrival-caption absolute inset-x-6 text-balance text-center font-display text-2xl">{{ t('onboarding.ready') }}</p>
    </div>
  </Teleport>
</template>

<style scoped>
.onboarding-arrival { transition: opacity var(--fade) ease; }
.onboarding-arrival.is-leaving { opacity: 0; }

.arrival-paper { opacity: 0; transition: opacity 280ms ease; }
.is-unfolding .arrival-paper, .is-leaving .arrival-paper { opacity: 1; }

.brand-flight {
  transform: rotate(9deg);
  transition: transform 720ms cubic-bezier(0.5, 0, 0.15, 1), opacity 280ms ease;
}
.brand-flight.is-flying { transform: translate(var(--dx), var(--dy)) rotate(-15deg) scale(var(--scale)); }
.is-unfolding .brand-flight, .is-leaving .brand-flight { opacity: 0; }

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
  .arrival-paper { opacity: 0; transition: opacity 280ms ease; }
.is-unfolding .arrival-paper, .is-leaving .arrival-paper { opacity: 1; }

.brand-flight {
  transform: rotate(9deg);
  transition: transform 720ms cubic-bezier(0.5, 0, 0.15, 1), opacity 280ms ease;
}
.brand-flight.is-flying { transform: translate(var(--dx), var(--dy)) rotate(-15deg) scale(var(--scale)); }
.is-unfolding .brand-flight, .is-leaving .brand-flight { opacity: 0; }

.arrival-caption { animation: none; }
}
</style>
