<script setup lang="ts">
import { onMounted, onUnmounted, useTemplateRef } from 'vue'
import { storeToRefs } from 'pinia'
import { useMapStore } from '../../stores/map.store'
import { useMapService } from '@/services/map.service'
import { MapStrategy } from './map-providers/map.strategy'
import { TransitionExpand } from '@morev/vue-transitions'

import StreetView from '@/components/map/StreetView.vue'
import ContextMenu from '@/components/map/ContextMenu.vue'

const mapService = useMapService()
const mapStore = useMapStore()

const { streetView } = storeToRefs(mapStore)

const mapContainer = useTemplateRef<HTMLElement>('mapContainer')
let mapStrategy: MapStrategy

onMounted(() => {
  if (!mapContainer.value) {
    throw new Error('Map container element not found')
  }
  mapStrategy = mapService.initializeMap(mapContainer.value, mapStore.mapEngine)
})

onUnmounted(() => {
  mapService.destroy()
})
</script>

<template>
  <div>
    <div
      class="w-full absolute bottom-[7.5rem] md:bottom-0 right-0 z-50 p-2 flex flex-col gap-2 items-end pointer-events-none"
    >
      <LayerControls />

      <TransitionExpand>
        <StreetView
          v-if="streetView"
          :image="streetView"
          class="pointer-events-auto rounded-lg shadow-md w-full md:w-[40vw] aspect-video"
        />
      </TransitionExpand>
    </div>

    <div ref="mapContainer" class="w-full h-full"></div>

    <ContextMenu />
  </div>
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
