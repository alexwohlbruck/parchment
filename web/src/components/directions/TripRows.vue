<script setup lang="ts">
import { computed } from 'vue'
import { byRank } from '@/lib/directions/trip-display'
import type { TripOption } from '@/types/directions.types'

const props = defineProps<{ trips: TripOption[] }>()

const ranked = computed(() => byRank(props.trips))
</script>

<template>
  <!-- Staggered entrance as a fresh set of suggestions loads -->
  <TransitionGroup name="trip" tag="div" class="flex flex-col" appear>
    <div
      v-for="(trip, index) in ranked"
      :key="trip.id || index"
      :style="{ '--trip-delay': `${Math.min(index, 8) * 45}ms` }"
    >
      <slot :trip="trip" :index="index" />
      <div
        v-if="index < ranked.length - 1"
        class="border-b border-border/50 mx-4"
      />
    </div>
  </TransitionGroup>

  <div v-if="!ranked.length" class="text-center py-8 text-muted-foreground">
    <p class="text-sm">No trips available</p>
  </div>
</template>

<style scoped>
/* Each row fades and lifts in, offset by its index via the inline
   --trip-delay. `appear` replays it whenever a new result set mounts. */
.trip-enter-active {
  transition:
    opacity 0.4s ease,
    transform 0.4s cubic-bezier(0.22, 1, 0.36, 1);
  transition-delay: var(--trip-delay, 0ms);
}

.trip-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

@media (prefers-reduced-motion: reduce) {
  .trip-enter-active {
    transition: opacity 0.2s ease;
    transition-delay: 0ms;
  }
  .trip-enter-from {
    transform: none;
  }
}
</style>
