<script setup lang="ts">
import { computed } from 'vue'
import { ArrowUpFromDotIcon, ArrowDownToDotIcon } from 'lucide-vue-next'

// TODO: Merge this with WaypointIcon.vue

const props = defineProps<{
  index: number
  totalWaypoints: number
  type?: 'origin' | 'destination' | 'waypoint'
}>()

const isFrom = computed(() => props.index === 0 || props.type === 'origin')
const isTo = computed(
  () =>
    (props.index === 1 && props.totalWaypoints === 2) ||
    (props.type === 'destination' && props.totalWaypoints === 2),
)
const showNumber = computed(
  () => props.totalWaypoints > 2 && props.index > 0 && props.type !== 'origin',
)
</script>

<template>
  <div class="relative size-8 shrink-0 cursor-move">
    <!-- Map marker circle -->
    <div
      class="absolute inset-0 size-6 border-2 border-white rounded-full flex items-center justify-center shadow-lg"
      :class="{
        'bg-primary': true,
      }"
    >
      <!-- From icon (always show for first waypoint or origin) -->
      <ArrowUpFromDotIcon v-if="isFrom" class="size-3 text-white rotate-90" />
      <!-- To icon (destination or second waypoint when only 2 waypoints) -->
      <ArrowDownToDotIcon
        v-else-if="isTo"
        class="size-3 text-white -rotate-90"
      />
      <!-- Number for multi-stop routes (skip first waypoint) -->
      <span v-else-if="showNumber" class="text-white text-xs font-bold">
        {{ index }}
      </span>
    </div>
  </div>
</template>
