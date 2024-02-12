<template>
  <div ref="mapContainer"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
// import { useRouter } from "vue-router";
// import { useSettingsStore } from "@/stores/settings";
// import { AppTheme } from "../../types/settings";
import { useDark } from '@vueuse/core'
import { MapLibrary, useMapStore } from '../../stores/map.store'
import { MapboxStrategy } from './map-providers/mapbox.strategy'
import { MapStrategy } from './map-providers/map.strategy'
import { MaplibreStrategy } from './map-providers/maplibre.strategy'

const dark = useDark()
const mapStore = useMapStore()

const mapContainer = ref(null)
let map: MapStrategy

function getMapInstance(mapLibrary: MapLibrary) {
  const options = {
    dark: dark.value,
  }
  switch (mapLibrary) {
    case 'mapbox':
      return new MapboxStrategy(mapContainer.value, options)
    case 'maplibre':
      return new MaplibreStrategy(mapContainer.value, options)
  }
}

onMounted(() => {
  map = getMapInstance(mapStore.mapLibrary)

  watch(dark, map.setMapTheme)
  watch(
    () => mapStore.activeBasemapName,
    name => {
      console.log(mapStore.basemaps, name)
      map.setStyle(mapStore.basemaps[name].url)
    },
  )
  watch(
    () => mapStore.mapLibrary,
    sdk => {
      map = getMapInstance(sdk)
    },
  )
})

onUnmounted(() => {
  map.remove()
})
</script>

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
