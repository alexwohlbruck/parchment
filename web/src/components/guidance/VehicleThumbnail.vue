<script setup lang="ts">
import { computed } from 'vue'
import { inkOn, type VehicleIndicator } from '@/lib/guidance/vehicle-indicator'

const props = defineProps<{ indicator: VehicleIndicator; color: string }>()

const BODIES: Record<'hatchback' | 'suv' | 'pickup', { body: string; glass: string; wheels: number[] }> = {
  hatchback: {
    body: 'M8 28.5V24c0-1.6 1-2.6 2.6-3l7.4-1.7 6.2-5.2c.8-.6 1.7-1 2.7-1h13.6c1.4 0 2.6.9 3 2.2l2.6 6.4c.5 1.2.9 2.4.9 3.7v3.1z',
    glass: 'M20.5 19.4l5-4.3c.4-.3.9-.5 1.4-.5H32v4.8zM34 14.6h5.7c.6 0 1.1.4 1.3.9l1.6 3.9H34z',
    wheels: [16.5, 39.5],
  },
  suv: {
    body: 'M6 29v-5.5c0-1.5 1-2.6 2.4-2.9l7.6-1.7 4.7-6.3c.7-.9 1.7-1.4 2.8-1.4h20.1c1.4 0 2.6 1 2.9 2.4l1.3 6.2c.2.8.2 1.6.2 2.4V29z',
    glass: 'M18.8 19.1l4-5.3c.3-.4.8-.6 1.3-.6H31v5.9zM33 13.2h9.5c.6 0 1.1.4 1.2 1l.9 4.7H33z',
    wheels: [15, 41],
  },
  pickup: {
    body: 'M4 29v-5.6c0-1.4.9-2.5 2.3-2.8l6.9-1.6 4.6-5.8c.6-.8 1.6-1.2 2.6-1.2H30c1.1 0 2 .9 2 2V21h18.2c1 0 1.8.8 1.8 1.8V29z',
    glass: 'M15.9 19.2l3.8-4.8c.3-.4.7-.6 1.2-.6H29.5v5.4z',
    wheels: [13, 43],
  },
}

const car = computed(() => (props.indicator in BODIES ? BODIES[props.indicator as keyof typeof BODIES] : null))
const ink = computed(() => inkOn(props.color))
</script>

<template>
  <svg viewBox="0 0 56 36" class="h-9 w-14" aria-hidden="true">
    <template v-if="indicator === 'arrow'">
      <circle cx="28" cy="18" r="14" fill="white" class="drop-shadow-sm" />
      <circle cx="28" cy="18" r="11.5" :fill="color" />
      <path d="M28 9.5l6 14.5-6-3.3-6 3.3z" :fill="ink" />
    </template>
    <template v-else-if="car">
      <ellipse cx="28" cy="31" rx="24" ry="2" fill="currentColor" opacity="0.12" />
      <path :d="car.body" :fill="color" stroke="rgb(0 0 0 / 0.25)" stroke-width="0.6" />
      <path :d="car.glass" fill="#1e2a36" opacity="0.85" />
      <g v-for="x in car.wheels" :key="x">
        <circle :cx="x" cy="28.5" r="4.6" fill="#1b1c1e" />
        <circle :cx="x" cy="28.5" r="2" fill="#8a8f96" />
      </g>
    </template>
    <g v-else transform="translate(56 0) scale(-1 1)">
      <ellipse cx="28" cy="32" rx="20" ry="1.6" fill="currentColor" opacity="0.12" />
      <g fill="none" stroke="#1b1c1e" stroke-width="2">
        <circle cx="16" cy="25" r="6.5" />
        <circle cx="40" cy="25" r="6.5" />
      </g>
      <path d="M16 25l7-10h11l-7 10zM34 15l6 10M23 15l-1.5-3M35 12.5l-1 2.5" fill="none" :stroke="color" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M22 11.5l10-6.5M32 5l3.5 7" fill="none" :stroke="color" stroke-width="3.6" stroke-linecap="round" />
      <circle cx="34" cy="3.6" r="2.4" fill="#2a2d31" />
    </g>
  </svg>
</template>
