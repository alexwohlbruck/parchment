<script setup lang="ts">
import { computed } from 'vue'
import {
  GripHorizontalIcon,
  ArrowUpFromDotIcon,
  ArrowDownToDotIcon,
} from 'lucide-vue-next'

const props = defineProps<{
  index: number
  totalWaypoints: number
  isDragging?: boolean
}>()

const showIcons = computed(() => props.totalWaypoints === 2)
const isFrom = computed(() => props.index === 0)
const isTo = computed(() => props.index === 1 && props.totalWaypoints === 2)
const showNumber = computed(() => props.totalWaypoints > 2 && props.index > 0)
</script>

<template>
  <div class="relative size-6 flex-shrink-0 cursor-move handle">
    <!-- Default state: icons for from/to or numbered circle -->
    <div
      class="absolute inset-0 size-6 border-2 border-white rounded-full flex items-center justify-center transition-opacity duration-200 group-hover:opacity-0"
      :class="{
        'bg-primary': true,
      }"
    >
      <!-- From icon (always show for first waypoint) -->
      <ArrowUpFromDotIcon v-if="isFrom" class="size-3 text-white rotate-90" />
      <!-- To icon (second waypoint when only 2 waypoints) -->
      <ArrowDownToDotIcon
        v-else-if="showIcons && isTo"
        class="size-3 text-white -rotate-90"
      />
      <!-- Number for multi-stop routes (skip first waypoint) -->
      <span v-else-if="showNumber" class="text-white text-xs font-semibold">
        {{ index }}
      </span>
    </div>

    <!-- Hover state: grip icon -->
    <div
      class="absolute inset-0 size-6 bg-primary rounded-full flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100"
    >
      <GripHorizontalIcon class="size-3 text-primary-foreground" />
    </div>
  </div>
</template>
