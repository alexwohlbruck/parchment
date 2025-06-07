<script setup lang="ts">
import { computed, onMounted, onUnmounted, useTemplateRef, watch } from 'vue'
import { useMapStore } from '../../stores/map.store'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { useMapService } from '@/services/map.service'
import { MapStrategy } from './map-providers/map.strategy'
import { MapEngine } from '@/types/map.types'

import ContextMenu from '@/components/map/ContextMenu.vue'
import MapLoading from '@/components/map/MapLoading.vue'
import MapboxFallback from '@/components/map/MapboxFallback.vue'

const mapService = useMapService()
const mapStore = useMapStore()
const integrationsStore = useIntegrationsStore()

const mapContainer = useTemplateRef<HTMLElement>('mapContainer')
let mapStrategy: MapStrategy

const props = defineProps<{
  pipSwapped: boolean
}>()

const mapControlsVisibility = computed(() =>
  props.pipSwapped ? 'hidden' : 'visible',
)

// Computed properties for map state
const isLoadingIntegrations = computed(() => {
  return !integrationsStore.integrationsReady
})

const shouldShowMapboxFallback = computed(() => {
  // Only show fallback if integrations are ready, we're using Mapbox, and Mapbox is available but not configured
  return (
    integrationsStore.integrationsReady &&
    mapStore.mapEngine === MapEngine.MAPBOX &&
    integrationsStore.isMapboxAvailableButNotConfigured
  )
})

const canInitializeMapContainer = computed(() => {
  // We can initialize the map container as soon as integrations are ready
  return integrationsStore.integrationsReady
})

const shouldShowMap = computed(() => {
  // Show the map if integrations are ready and we're not showing the Mapbox fallback
  return integrationsStore.integrationsReady && !shouldShowMapboxFallback.value
})

onMounted(() => {
  // Set the map container reference immediately when component mounts
  if (mapContainer.value) {
    mapService.setMapContainer(mapContainer.value)
  }

  // Watch for integrations to be ready and then initialize map
  watch(
    [() => canInitializeMapContainer.value],
    ([canInit]) => {
      if (canInit && mapContainer.value && !mapStrategy) {
        const result = mapService.initializeMap(
          mapContainer.value,
          mapStore.mapEngine,
        )
        // Only set mapStrategy if initialization was successful
        if (result) {
          mapStrategy = result
        }
      }
    },
    { immediate: true },
  )
})

onUnmounted(() => {
  mapService.destroy()
})

// Resize the map when street view pip is swapped. We are accounting for the transition animation.
watch(
  () => props.pipSwapped,
  () => {
    if (props.pipSwapped) {
      const interval = setInterval(() => {
        mapService.resize()
      }, 1000 / 30)
      setTimeout(() => {
        clearInterval(interval)
      }, 300)
    } else {
      setTimeout(() => {
        mapService.resize()
      }, 0)
    }
  },
)
</script>

<template>
  <!-- Always render the map container, but conditionally show content -->
  <div ref="mapContainer" class="w-full h-full">
    <!-- Show loading state while integrations are loading -->
    <MapLoading v-if="isLoadingIntegrations" />

    <!-- Show Mapbox fallback if Mapbox is selected but not configured -->
    <MapboxFallback v-else-if="shouldShowMapboxFallback" />
  </div>

  <!-- Context menu is always available -->
  <ContextMenu v-if="shouldShowMap" />
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

.mapboxgl-control-container {
  visibility: v-bind(mapControlsVisibility);
}

.mapboxgl-ctrl-top,
.mapboxgl-ctrl-top-left,
.mapboxgl-ctrl-top-right {
  padding-top: env(safe-area-inset-top);
}

.mapboxgl-ctrl-bottom,
.mapboxgl-ctrl-bottom-left,
.mapboxgl-ctrl-bottom-right {
  padding-bottom: env(safe-area-inset-bottom);
}

.mapboxgl-ctrl-left,
.mapboxgl-ctrl-left-top,
.mapboxgl-ctrl-right-bottom {
  padding-right: env(safe-area-inset-right);
}

.mapboxgl-ctrl-right,
.mapboxgl-ctrl-right-top,
.mapboxgl-ctrl-right-bottom {
  padding-right: env(safe-area-inset-right);
}

.mapboxgl-ctrl-logo {
  display: none !important;
}

.mapboxgl-ctrl-geolocate {
  display: none !important;
}
</style>
