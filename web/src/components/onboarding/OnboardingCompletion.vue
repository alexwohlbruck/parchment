<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMediaQuery } from '@vueuse/core'

const emit = defineEmits<{ reveal: []; complete: [] }>()
const { t } = useI18n()
const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
const timers: ReturnType<typeof setTimeout>[] = []
let revealed = false
let completed = false

function reveal() {
  if (revealed) return
  revealed = true
  emit('reveal')
}

function complete() {
  if (completed) return
  completed = true
  timers.forEach(clearTimeout)
  reveal()
  emit('complete')
}

onMounted(() => {
  if (reducedMotion.value) return complete()
  timers.push(setTimeout(reveal, 800), setTimeout(complete, 1600))
})

watch(reducedMotion, reduced => {
  if (reduced) complete()
})

onUnmounted(() => timers.forEach(clearTimeout))
</script>

<template>
  <Teleport to="body">
    <div class="onboarding-arrival fixed inset-0 z-[80] flex flex-col items-center justify-center gap-8 bg-background px-6 text-foreground" role="status" aria-live="polite" aria-atomic="true">
      <div class="paper-map" aria-hidden="true">
        <div v-for="panel in 3" :key="panel" class="map-panel" :class="`map-panel-${panel}`">
          <svg :viewBox="`${(panel - 1) * 80} 0 80 150`" class="size-full" preserveAspectRatio="none">
            <path class="map-park" d="M0 0H66L46 48 0 66ZM150 100L240 76V150H176Z" />
            <path class="map-water" d="M174-10C136 28 191 47 152 80S132 123 146 160" />
            <path class="map-road" d="M-10 110 52 76 91 96 132 58 250 20M20-10 52 76 28 160M100-10 108 46 132 58 176 160" />
            <path class="map-route" d="M29 111 52 76 91 96 132 58 196 39" />
            <circle cx="29" cy="111" r="5" class="map-origin" />
            <g class="map-pin">
              <path d="M196 44s-11-11-11-19a11 11 0 0 1 22 0c0 8-11 19-11 19Z" />
              <circle cx="196" cy="25" r="3.5" />
            </g>
          </svg>
        </div>
      </div>
      <p class="arrival-caption text-balance text-center text-2xl font-semibold">{{ t('onboarding.ready') }}</p>
    </div>
  </Teleport>
</template>

<style scoped>
.onboarding-arrival {
  animation: reveal-map 1.6s ease both;
}

.paper-map {
  display: flex;
  width: min(72vw, 264px);
  aspect-ratio: 8 / 5;
  perspective: 800px;
  transform-style: preserve-3d;
  animation: open-map 1.4s cubic-bezier(0.2, 0.7, 0.2, 1) both;
}

.map-panel {
  width: calc(100% / 3);
  height: 100%;
  background: hsl(var(--background));
  border-block: 1px solid hsl(var(--foreground) / 0.12);
  box-shadow: 0 16px 28px -16px hsl(var(--foreground) / 0.3);
  backface-visibility: hidden;
}

.map-panel-1 {
  transform-origin: right center;
  border-left: 1px solid hsl(var(--foreground) / 0.12);
  border-radius: 6px 0 0 6px;
  animation: unfold-left 850ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
}

.map-panel-2 {
  background: hsl(var(--primary) / 0.07);
}

.map-panel-3 {
  transform-origin: left center;
  border-right: 1px solid hsl(var(--foreground) / 0.12);
  border-radius: 0 6px 6px 0;
  animation: unfold-right 850ms 100ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
}

.map-park {
  fill: hsl(var(--primary) / 0.13);
}

.map-water {
  fill: none;
  stroke: hsl(var(--primary) / 0.12);
  stroke-width: 16;
}

.map-road {
  fill: none;
  stroke: hsl(var(--muted-foreground) / 0.2);
  stroke-width: 3;
  stroke-linejoin: round;
}

.map-route {
  fill: none;
  stroke: hsl(var(--primary));
  stroke-width: 2.5;
  stroke-dasharray: 3 5;
  stroke-linecap: round;
}

.map-origin {
  fill: hsl(var(--background));
  stroke: hsl(var(--primary));
  stroke-width: 2.5;
}

.map-pin path {
  fill: hsl(var(--primary));
}

.map-pin circle {
  fill: hsl(var(--primary-foreground));
}

.arrival-caption {
  animation: arrival-caption 1.6s ease both;
}

@keyframes unfold-left {
  from { transform: rotateY(78deg); filter: brightness(0.75); }
  to { transform: rotateY(-8deg); filter: brightness(1); }
}

@keyframes unfold-right {
  from { transform: rotateY(-78deg); filter: brightness(0.75); }
  to { transform: rotateY(8deg); filter: brightness(1); }
}

@keyframes open-map {
  0% { transform: translateY(16px) scale(0.8) rotate(-10deg); opacity: 0; }
  20% { opacity: 1; }
  70% { transform: translateY(0) scale(1) rotate(-3deg); opacity: 1; }
  100% { transform: translateY(-8px) scale(1.12) rotate(0); opacity: 0; }
}

@keyframes arrival-caption {
  0%, 12% { opacity: 0; transform: translateY(6px); }
  30%, 70% { opacity: 1; transform: translateY(0); }
  100% { opacity: 0; transform: translateY(-4px); }
}

@keyframes reveal-map {
  0%, 70% { opacity: 1; }
  100% { opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .onboarding-arrival, .paper-map, .map-panel, .arrival-caption {
    animation: none;
  }
}
</style>
