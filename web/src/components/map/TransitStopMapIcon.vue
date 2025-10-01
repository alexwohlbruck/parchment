<script setup lang="ts">
import { computed } from 'vue'
import { 
  type TransitStop, 
  type TransitRoute,
  getRouteColor,
  TRANSITLAND_DEFAULT_COLOR 
} from '@/lib/transit.utils'

const props = defineProps<{
  stop: TransitStop
  isHovered?: boolean
}>()

const emit = defineEmits<{
  click: [stop: TransitStop, event: MouseEvent]
  mouseenter: [stop: TransitStop, event: MouseEvent]
  mouseleave: [stop: TransitStop, event: MouseEvent]
}>()

const routeColors = computed(() => {
  if (!props.stop.routes || props.stop.routes.length === 0) {
    return [TRANSITLAND_DEFAULT_COLOR]
  }
  
  return props.stop.routes.map(route => 
    getRouteColor(route.route_color, route.route_type)
  )
})

const routeNames = computed(() => {
  if (!props.stop.routes) return []
  
  return props.stop.routes.map(route => 
    route.route_short_name || route.route_long_name || route.route_id || 'Unknown'
  ).slice(0, 4) // Limit to 4 routes for display
})

function handleClick(event: MouseEvent) {
  emit('click', props.stop, event)
}

function handleMouseEnter(event: MouseEvent) {
  emit('mouseenter', props.stop, event)
}

function handleMouseLeave(event: MouseEvent) {
  emit('mouseleave', props.stop, event)
}
</script>

<template>
  <div 
    class="relative cursor-pointer select-none"
    @click="handleClick"
    @mouseenter="handleMouseEnter"
    @mouseleave="handleMouseLeave"
  >
    <!-- Stop name label (Apple Maps style) -->
    <div 
      class="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-white/95 backdrop-blur-sm rounded-md shadow-lg border border-gray-200 whitespace-nowrap transition-all duration-200"
      :class="{
        'scale-110 shadow-xl': props.isHovered,
        'scale-100': !props.isHovered
      }"
    >
      <!-- Stop name -->
      <div class="text-xs font-medium text-gray-900 mb-1">
        {{ props.stop.stop_name }}
      </div>
      
      <!-- Route indicators -->
      <div v-if="routeNames.length > 0" class="flex items-center gap-1 flex-wrap">
        <div 
          v-for="(routeName, index) in routeNames" 
          :key="index"
          class="flex items-center gap-1"
        >
          <!-- Route color dot -->
          <div 
            class="w-2 h-2 rounded-full border border-white shadow-sm"
            :style="{ backgroundColor: routeColors[index] || '#007cbf' }"
          />
          <!-- Route name -->
          <span class="text-xs text-gray-600 font-medium">
            {{ routeName }}
          </span>
        </div>
        <!-- Show "+" if more routes -->
        <span v-if="props.stop.routes && props.stop.routes.length > 4" class="text-xs text-gray-500">
          +{{ props.stop.routes.length - 4 }}
        </span>
      </div>
    </div>

    <!-- Stop marker dot -->
    <div 
      class="w-3 h-3 rounded-full border-2 border-white shadow-lg transition-all duration-200"
      :class="{
        'w-4 h-4': props.isHovered,
        'w-3 h-3': !props.isHovered
      }"
      :style="{ 
        backgroundColor: routeColors[0] || '#007cbf'
      }"
    />
  </div>
</template>
