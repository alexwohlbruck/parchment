<script setup lang="ts">
import { onMounted, onUnmounted, useTemplateRef, watch } from 'vue'
import { useMapStore } from '../../stores/map.store'
import { useMapService } from '@/services/map.service'
import { MapStrategy } from './map-providers/map.strategy'

import ContextMenu from '@/components/map/ContextMenu.vue'

const mapService = useMapService()
const mapStore = useMapStore()

const mapContainer = useTemplateRef<HTMLElement>('mapContainer')
let mapStrategy: MapStrategy

const props = defineProps<{
  pipSwapped: boolean
}>()

onMounted(() => {
  if (!mapContainer.value) {
    throw new Error('Map container element not found')
  }
  mapStrategy = mapService.initializeMap(mapContainer.value, mapStore.mapEngine)
})

onUnmounted(() => {
  mapService.destroy()
})

watch(
  () => props.pipSwapped,
  () => {
    setTimeout(() => {
      mapService.resize()
    }, 0)
  },
)
</script>

<template>
  <div ref="mapContainer" class="w-full h-full"></div>

  <ContextMenu />
</template>

<style>
.mapboxgl-canvas,
.maplibregl-canvas {
  outline: none;
}

.mapboxgl-ctrl-scale,
.maplibregl-ctrl-scale {
  font-weight: 700;
  font-family: var(--font);
}

.dark .mapboxgl-ctrl-scale,
.dark .maplibregl-ctrl-scale {
  color: hsl(var(--foreground));
}

.dark .mapboxgl-ctrl-group,
.dark .maplibregl-ctrl-group,
.dark .mapboxgl-ctrl-scale,
.dark .maplibregl-ctrl-scale {
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}

.dark .mapboxgl-ctrl-icon,
.dark .maplibregl-ctrl-icon {
  filter: invert(1);
}
</style>
