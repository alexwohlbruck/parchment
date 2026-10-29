<script setup lang="ts">
import { computed, inject, ref, useSlots, type Component } from 'vue'
import ParchmentTile from './ParchmentTile.vue'
import { stepIndexKey } from './types'

const props = defineProps<{
  title: string
  description: string
  icon?: Component
  tall?: boolean
  /** Let the card's own contour backdrop show through instead of drawing a banner. */
  bleed?: boolean
}>()
const slots = useSlots()
const solo = computed(() => !props.icon && !slots.tile)

const step = inject(stepIndexKey, ref(0)).value
const jitter = (salt: number) => Math.sin((step + 1) * 12.9898 + salt * 78.233) * 0.5 + 0.5
const motion = {
  '--ix': `${14 + jitter(1) * 10}px`,
  '--iy': `${(jitter(2) - 0.5) * 20}px`,
  '--ir': `${(jitter(3) - 0.5) * 24}deg`,
  '--ox': `${12 + jitter(4) * 10}px`,
  '--oy': `${(jitter(5) - 0.5) * 16}px`,
  '--or': `${8 + jitter(6) * 14}deg`,
}
</script>

<template>
  <div :class="bleed ? 'space-y-1' : 'space-y-6'">
    <div
      class="relative flex items-center justify-center rounded-2xl"
      :class="[tall ? (bleed ? 'h-32' : 'h-44') : 'h-32', !bleed && 'overflow-hidden border bg-primary/5']"
    >
      <div v-if="!bleed" class="onboarding-topo absolute inset-0" aria-hidden="true" />
      <slot name="art" />
      <div class="relative flex items-center" :class="bleed && 'translate-y-3'" :style="motion">
        <div v-if="!solo" class="hero-tile relative z-10" style="--tilt: -7deg; --dir: -1">
          <slot name="tile">
            <div class="flex size-20 items-center justify-center rounded-2xl border bg-background shadow-sm" aria-hidden="true">
              <component :is="icon" class="size-10 text-primary" :stroke-width="1.5" />
            </div>
          </slot>
          <span v-if="$slots.badge" class="absolute -bottom-2 -right-2 z-20 flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm" aria-hidden="true">
            <slot name="badge" />
          </span>
        </div>
        <ParchmentTile
          class="hero-tile"
          :class="solo ? 'size-20' : '-ml-3 mt-7 size-14'"
          :style="solo ? '--tilt: -6deg; --dir: 1' : '--tilt: 9deg; --dir: 1; --delay: 90ms'"
          aria-hidden="true"
        />
      </div>
    </div>
    <div class="space-y-2 text-center">
      <h2 class="text-balance text-2xl font-semibold">{{ title }}</h2>
      <p class="mx-auto max-w-md text-pretty text-sm leading-relaxed text-muted-foreground">{{ description }}</p>
    </div>
  </div>
</template>

<style scoped>
.hero-tile {
  --delay: 0ms;
  transform: rotate(var(--tilt));
  animation: tile-in 620ms cubic-bezier(0.34, 1.4, 0.5, 1) var(--delay) both;
}

:global(.onboarding-step-leave-active) .hero-tile {
  animation: tile-out 300ms cubic-bezier(0.5, 0, 0.9, 0.5) calc(var(--delay) / 2) both;
}

@keyframes tile-in {
  from {
    opacity: 0;
    transform: translate(calc(var(--dir) * var(--ix)), var(--iy)) rotate(calc(var(--tilt) + var(--dir) * var(--ir))) scale(0.75);
  }
}

@keyframes tile-out {
  to {
    opacity: 0;
    transform: translate(calc(var(--dir) * var(--ox)), var(--oy)) rotate(calc(var(--tilt) + var(--dir) * var(--or))) scale(0.8);
  }
}

@media (prefers-reduced-motion: reduce) {
  .hero-tile, :global(.onboarding-step-leave-active) .hero-tile { animation: none; }
}
</style>
