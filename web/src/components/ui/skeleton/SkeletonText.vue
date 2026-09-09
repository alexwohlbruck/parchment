<script setup lang="ts">
import { computed } from 'vue'
import Skeleton from './Skeleton.vue'

/**
 * Placeholder text lines. Widths vary so a block reads as prose rather than a
 * stack of identical bars, and the last line is short the way a real paragraph
 * usually is.
 *
 * Widths are derived from the index rather than random so they don't reshuffle
 * on every re-render while data is still loading.
 */
const props = withDefaults(
  defineProps<{
    lines?: number
    /** Bar height; `sm` suits captions, `md` body text. */
    size?: 'sm' | 'md'
  }>(),
  { lines: 3, size: 'md' },
)

const WIDTHS = ['75%', '50%', '66%', '58%', '70%']

const widths = computed(() =>
  Array.from({ length: props.lines }, (_, i) =>
    i === props.lines - 1 && props.lines > 1 ? '40%' : WIDTHS[i % WIDTHS.length],
  ),
)
</script>

<template>
  <div class="space-y-2">
    <Skeleton
      v-for="(width, i) in widths"
      :key="i"
      :class="size === 'sm' ? 'h-4' : 'h-5'"
      :style="{ width }"
    />
  </div>
</template>
