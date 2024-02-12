<template>
  <div ref="mapContainer"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
// import { useRouter } from "vue-router";
// import { useSettingsStore } from "@/stores/settings";
// import { AppTheme } from "../../types/settings";
import { useDark } from '@vueuse/core'
import { useMapStore } from '../../stores/map.store'
import { MapboxStrategy } from './map-providers/mapbox.strategy'
import { MapStrategy } from './map-providers/map.strategy'

const dark = useDark()
const mapStore = useMapStore()

const mapContainer = ref(null)
let map: MapStrategy

function getMapInstance() {
  const mapSDK: string = 'mapbox'
  const options = {
    dark: dark.value,
  }
  switch (mapSDK) {
    case 'mapbox':
      return new MapboxStrategy(mapContainer.value, options)
    default: {
      throw new Error('Map SDK not selected')
    }
  }
}

onMounted(() => {
  map = getMapInstance()

  watch(dark, map.setMapTheme)
  watch(
    () => mapStore.activeBasemapName,
    name => {
      console.log(mapStore.basemaps, name)
      map.setStyle(mapStore.basemaps[name].url)
    }
  )
})

onUnmounted(() => {
  map.remove()
})
</script>

<style>
.mapboxgl-canvas {
  outline: none;
}

.mapboxgl-ctrl-scale {
  font-weight: 700;
  font-family: var(--font);
}

.dark .mapboxgl-ctrl-scale {
  color: hsl(var(--foreground));
}

.dark .mapboxgl-ctrl-group,
.dark .mapboxgl-ctrl-scale {
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}

.dark .mapboxgl-ctrl-icon {
  filter: invert(1);
}
</style>
