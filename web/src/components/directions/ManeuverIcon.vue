<script setup lang="ts">
import { computed } from 'vue'
import type { ManeuverKind } from '@/lib/directions/maneuver'

const props = defineProps<{ kind: ManeuverKind; exit?: number }>()

// Drawn for a 24×24 box, travelling up; left variants mirror the right ones.
const PATHS: Record<string, string> = {
  straight: 'M12 21V4M6.5 9.5 12 4l5.5 5.5',
  'slight-right': 'M8 21v-6.5c0-2 .8-3.4 2.2-4.8L16 4M10.5 4H16v5.5',
  right: 'M7 21v-8a4 4 0 0 1 4-4h9M15 4l5 5-5 5',
  'sharp-right': 'M7 3v10a4 4 0 0 0 4 4h5.5M12 21l4.5-4.5L12 12',
  'keep-right': 'M8 21v-5c0-2.2 1-3.6 2.5-4.8L15 8M8 15V4M11 8h4v4',
  uturn: 'M16 21V10a5 5 0 0 0-10 0v6M2.5 13 6 16.5 9.5 13',
  arrive: 'M6 21V4M6 4h10l-2 4 2 4H6',
  board: 'M8 3h8a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3ZM5 10h14M9 21l1.5-4M15 21l-1.5-4',
}

const mirrored = computed(() => props.kind.endsWith('-left'))
const path = computed(() => PATHS[props.kind.replace('-left', '-right')] ?? PATHS.straight)
</script>

<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2.4"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-if="kind === 'roundabout'">
      <circle cx="12" cy="10" r="4" />
      <path d="M12 21v-7M15.5 7.5 20 3M16 3h4v4" />
      <text v-if="exit" x="12" y="11.5" text-anchor="middle" font-size="5" stroke="none" fill="currentColor">{{ exit }}</text>
    </template>
    <path v-else :d="path" :transform="mirrored ? 'matrix(-1 0 0 1 24 0)' : undefined" />
  </svg>
</template>
