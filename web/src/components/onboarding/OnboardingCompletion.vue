<script setup lang="ts">
import { onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMediaQuery } from '@vueuse/core'
import { useMapService } from '@/services/map/map.service'
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
const fade = 450
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
  phase.value = 'unfolding'
  emit('start')
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
})
</script>

<template>
  <Teleport to="body">
    <div class="onboarding-arrival onboarding-backdrop fixed inset-0 z-40 bg-background" :class="`is-${phase}`" :style="{ '--fade': `${fade}ms` }" aria-hidden="true">
      <canvas ref="canvas" class="absolute inset-0 size-full" />
    </div>
    <div class="onboarding-arrival pointer-events-none fixed inset-0 z-[80] text-foreground" :class="`is-${phase}`" :style="{ '--fade': `${fade}ms` }" role="status" aria-live="polite" aria-atomic="true">
      <p v-if="phase !== 'waiting'" class="arrival-caption absolute inset-x-6 text-balance text-center font-display text-2xl">{{ t('onboarding.ready') }}</p>
    </div>
  </Teleport>
</template>

<style scoped>
.onboarding-arrival { transition: opacity var(--fade) ease; }
.onboarding-arrival.is-leaving { opacity: 0; }

.arrival-caption {
  bottom: max(10vh, 40px);
  animation: arrival-caption 600ms 250ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
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
