<script setup lang="ts">
import { inject, ref, type Component } from 'vue'
import ParchmentTile from './ParchmentTile.vue'
import { stepIndexKey } from './types'

defineProps<{
  title: string
  description: string
  icon?: Component
  tall?: boolean
}>()

const MOTIONS = 5
const motion = inject(stepIndexKey, ref(0)).value % MOTIONS
</script>

<template>
  <div class="space-y-6">
    <div class="relative flex items-center justify-center overflow-hidden rounded-2xl border bg-primary/5" :class="tall ? 'h-44' : 'h-32'">
      <div class="hero-grid absolute inset-0 opacity-40" aria-hidden="true" />
      <div class="absolute h-48 w-12 rotate-[35deg] border-x-4 border-background bg-primary/10" aria-hidden="true" />
      <slot name="art" />
      <div class="relative flex items-center" :data-motion="motion">
        <div class="hero-tile relative z-10" style="--tilt: -7deg; --dir: -1">
          <slot name="tile">
            <div class="flex size-20 items-center justify-center rounded-2xl border bg-background shadow-sm" aria-hidden="true">
              <component :is="icon" class="size-10 text-primary" :stroke-width="1.5" />
            </div>
          </slot>
          <span v-if="$slots.badge" class="absolute -bottom-2 -right-2 z-20 flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm" aria-hidden="true">
            <slot name="badge" />
          </span>
        </div>
        <ParchmentTile class="hero-tile -ml-3 mt-7 size-14" style="--tilt: 9deg; --dir: 1; --delay: 90ms" data-onboarding-brand aria-hidden="true" />
      </div>
    </div>
    <div class="space-y-2 text-center">
      <h2 class="text-balance text-2xl font-semibold">{{ title }}</h2>
      <p class="mx-auto max-w-md text-pretty text-sm leading-relaxed text-muted-foreground">{{ description }}</p>
    </div>
  </div>
</template>

<style scoped>
.hero-grid {
  background-image: linear-gradient(to right, hsl(var(--primary) / 0.12) 1px, transparent 1px),
    linear-gradient(to bottom, hsl(var(--primary) / 0.12) 1px, transparent 1px);
  background-size: 28px 28px;
  transform: rotate(-12deg) scale(1.3);
}

.hero-tile {
  --delay: 0ms;
  transform: rotate(var(--tilt));
  animation: tile-in var(--in-time) var(--in-ease) var(--delay) both;
}

:global(.onboarding-step-leave-active) .hero-tile {
  animation: tile-out 300ms cubic-bezier(0.5, 0, 0.9, 0.5) calc(var(--delay) / 2) both;
}

[data-motion='0'] {
  --in-time: 620ms; --in-ease: cubic-bezier(0.34, 1.4, 0.5, 1);
  --ix: 18px; --iy: 10px; --ir: 0deg; --is: 0.7;
  --ox: 26px; --oy: 0px; --or: 18deg; --os: 0.8;
}

[data-motion='1'] {
  --in-time: 700ms; --in-ease: cubic-bezier(0.3, 1.6, 0.5, 1);
  --ix: 4px; --iy: -70px; --ir: 14deg; --is: 1;
  --ox: 6px; --oy: 60px; --or: -20deg; --os: 0.9;
}

[data-motion='2'] {
  --in-time: 760ms; --in-ease: cubic-bezier(0.2, 1.3, 0.4, 1);
  --ix: 0px; --iy: 0px; --ir: -120deg; --is: 0.3;
  --ox: 0px; --oy: 0px; --or: 120deg; --os: 0.3;
}

[data-motion='3'] {
  --in-time: 640ms; --in-ease: cubic-bezier(0.34, 1.5, 0.5, 1);
  --ix: -30px; --iy: 40px; --ir: -24deg; --is: 0.85;
  --ox: -24px; --oy: -40px; --or: 24deg; --os: 0.85;
}

[data-motion='4'] {
  --in-time: 680ms; --in-ease: cubic-bezier(0.25, 1.25, 0.45, 1);
  --ix: 90px; --iy: -6px; --ir: 30deg; --is: 0.9;
  --ox: -90px; --oy: 6px; --or: -30deg; --os: 0.9;
}

@keyframes tile-in {
  from {
    opacity: 0;
    transform: translate(calc(var(--dir) * var(--ix)), var(--iy)) rotate(calc(var(--tilt) + var(--dir) * var(--ir))) scale(var(--is));
  }
}

@keyframes tile-out {
  to {
    opacity: 0;
    transform: translate(calc(var(--dir) * var(--ox)), var(--oy)) rotate(calc(var(--tilt) + var(--dir) * var(--or))) scale(var(--os));
  }
}

@media (prefers-reduced-motion: reduce) {
  .hero-tile, :global(.onboarding-step-leave-active) .hero-tile { animation: none; }
}
</style>
