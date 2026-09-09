<script setup lang="ts">
import Skeleton from './Skeleton.vue'

/**
 * A run of identical placeholder rows, for a list whose items haven't arrived.
 *
 * The default slot receives the index, so a caller can substitute a skeleton
 * shaped like its real row (see `PlaceCardSkeleton`); without one it falls back
 * to a plain block of the given height.
 */
withDefaults(
  defineProps<{
    count?: number
    /** Height of the fallback block, when no slot is supplied. */
    height?: string
  }>(),
  { count: 3, height: 'h-16' },
)
</script>

<template>
  <div class="space-y-2">
    <template v-for="i in count" :key="i">
      <slot :index="i - 1">
        <Skeleton class="rounded-lg" :class="height" />
      </slot>
    </template>
  </div>
</template>
