<script setup lang="ts">
import type { Component } from 'vue'
import ParchmentTile from './ParchmentTile.vue'

defineProps<{
  title: string
  description: string
  icon?: Component
  tall?: boolean
}>()
</script>

<template>
  <div class="space-y-6">
    <div class="relative flex items-center justify-center overflow-hidden rounded-2xl border bg-primary/5" :class="tall ? 'h-44' : 'h-32'">
      <div class="hero-grid absolute inset-0 opacity-40" aria-hidden="true" />
      <div class="absolute h-48 w-12 rotate-[35deg] border-x-4 border-background bg-primary/10" aria-hidden="true" />
      <slot name="art" />
      <div class="relative flex items-center">
        <div class="hero-tile relative z-10" style="--tilt: -7deg; --from: -18px">
          <slot name="tile">
            <div class="flex size-20 items-center justify-center rounded-2xl border bg-background shadow-sm" aria-hidden="true">
              <component :is="icon" class="size-10 text-primary" :stroke-width="1.5" />
            </div>
          </slot>
          <span v-if="$slots.badge" class="absolute -bottom-2 -right-2 z-20 flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm" aria-hidden="true">
            <slot name="badge" />
          </span>
        </div>
        <ParchmentTile class="hero-tile -ml-3 mt-7 size-14" style="--tilt: 9deg; --from: 18px; animation-delay: 90ms" data-onboarding-brand aria-hidden="true" />
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
  transform: rotate(var(--tilt));
  animation: tile-in 620ms cubic-bezier(0.34, 1.4, 0.5, 1) both;
}

@keyframes tile-in {
  from { opacity: 0; transform: translate(var(--from), 10px) rotate(0deg) scale(0.7); }
}

@media (prefers-reduced-motion: reduce) {
  .hero-tile { animation: none; }
}
</style>
