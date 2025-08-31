<script setup lang="ts">
import { computed } from 'vue'
import { ItemIcon } from '@/components/ui/item-icon'
import {
  getSearchResultIconName,
  getSearchResultName,
} from '@/lib/search.utils'
import type { Place } from '@/types/place.types'

const { place, isHovered } = defineProps<{
  place: Place
  isHovered?: boolean
}>()

const emit = defineEmits<{
  click: [place: Place, event: MouseEvent]
  mouseenter: [place: Place, event: MouseEvent]
  mouseleave: [place: Place, event: MouseEvent]
}>()

const iconName = computed(() => getSearchResultIconName(place))

function handleClick(event: MouseEvent) {
  emit('click', place, event)
}

function handleMouseEnter(event: MouseEvent) {
  emit('mouseenter', place, event)
}

function handleMouseLeave(event: MouseEvent) {
  emit('mouseleave', place, event)
}
</script>

<template>
  <!-- Map marker circle only, no label -->
  <div
    class="size-6 border-2 p-1 bg-white text-primary dark:bg-gray-900 border-white rounded-full flex items-center justify-center shadow-lg transition-all duration-300 ease-out cursor-pointer select-none relative overflow-hidden"
    :class="{
      'scale-125 shadow-xl': isHovered,
      'scale-100': !isHovered,
    }"
    style="border-color: hsl(var(--primary-foreground))"
    @click="handleClick"
    @mouseenter="handleMouseEnter"
    @mouseleave="handleMouseLeave"
  >
    <!-- Semi-transparent overlay for the colored background -->
    <div
      class="absolute inset-0 bg-primary/10 dark:bg-primary/20 rounded-full"
    ></div>
    <!-- Icon -->
    <ItemIcon
      :icon="iconName"
      color="primary"
      :class="{
        'size-2': !isHovered,
        'size-3': isHovered,
      }"
      class="transition-all duration-300 ease-out"
    />
  </div>
</template>

<style scoped>
/* Ensure the container doesn't interfere with map interactions when not hovered */
.relative {
  pointer-events: all;
}

/* Smooth animations for all properties */
.transition-all {
  transition-property: transform, box-shadow, width, height;
}
</style>
