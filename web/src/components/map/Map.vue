<template>
  <div ref="mapContainer"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDark } from '@vueuse/core'
import { useMapStore } from '../../stores/map.store'
import { MapboxStrategy } from './map-providers/mapbox.strategy'
import { MapStrategy } from './map-providers/map.strategy'
import { MaplibreStrategy } from './map-providers/maplibre.strategy'
import { MapLibrary, MapOptions } from '@/types/map.types'
import { Locale } from '@/lib/i18n'

const dark = useDark()
const mapStore = useMapStore()
const { locale } = useI18n()

const mapContainer = ref(null)
let map: MapStrategy

function getMapInstance(mapLibrary: MapLibrary) {
  const options: Partial<MapOptions> = {
    theme: dark.value ? 'dark' : 'light',
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

  watch(locale, locale => {
    map.setLocale(locale as Locale)
  })

  watch(dark, dark => {
    map.setMapTheme(dark ? 'dark' : 'light')
  })

  watch(
    () => mapStore.mapState.basemap,
    basemap => {
      map.setBasemap(basemap)
    },
  )

  watch(
    () => mapStore.mapState.layers,
    layers => {
      map.setLayers(layers)
    },
  )

  watch(
    () => mapStore.mapLibrary,
    mapLibrary => {
      map = getMapInstance(mapLibrary)
    },
  )

  watch(
    () => mapStore.directions,
    directions => {
      if (directions) {
        map.setDirections(directions)
      } else {
        map.unsetDirections()
      }
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
