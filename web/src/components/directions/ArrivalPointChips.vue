<script setup lang="ts">
import { PlaceCard } from '@/components/place/card'
import { useArrivalPoints } from '@/composables/directions/useArrivalPoints'

const { points, selectedId, toggle } = useArrivalPoints()
</script>

<template>
  <div
    v-if="points.length"
    class="-mx-3 flex gap-1.5 overflow-x-auto touch-pan-x scrollbar-hidden px-3 py-0.5"
  >
    <PlaceCard
      v-for="point in points"
      :key="point.id"
      :place="point"
      variant="chip"
      size="xs"
      icon-variant="ghost"
      as="button"
      :navigate="false"
      :aria-pressed="point.id === selectedId"
      class="shrink-0"
      :class="point.id === selectedId && 'border-primary ring-1 ring-primary'"
      @click="toggle(point)"
    />
  </div>
</template>
