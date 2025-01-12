<script setup lang="ts">
import { onMounted, onUnmounted, ref, useTemplateRef, computed } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useMapStore } from '../../stores/map.store'
import { useMapService } from '@/services/map.service'
import { useAppService } from '@/services/app.service'
import { useDirectionsService } from '@/services/directions.service'
import { MapStrategy } from './map-providers/map.strategy'
import { mapEventBus } from '@/lib/eventBus'
import { LngLat } from '@/types/map.types'
import { useDirectionsStore } from '@/stores/directions.store'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const router = useRouter()
const appService = useAppService()
const mapService = useMapService()
const mapStore = useMapStore()
const directionsService = useDirectionsService()
const directionsStore = useDirectionsStore()

const { waypoints } = storeToRefs(directionsStore)

const mapContainer = useTemplateRef<HTMLElement>('mapContainer')
let mapStrategy: MapStrategy

const showContextMenu = ref(false)
const contextMenuPosition = ref({ x: 0, y: 0 })
const clickedLngLat = ref<LngLat | null>(null)

onMounted(() => {
  if (!mapContainer.value) {
    throw new Error('Map container element not found')
  }
  mapStrategy = mapService.initializeMap(mapContainer.value, mapStore.mapEngine)

  mapEventBus.on('contextmenu', e => {
    contextMenuPosition.value = { x: e.point.x, y: e.point.y - 18 }
    clickedLngLat.value = e.lngLat
    showContextMenu.value = true
  })
})

onUnmounted(() => {
  mapService.destroy()
})

function copyCoordinates(lngLat: LngLat) {
  const coordString = `${lngLat.lat}, ${lngLat.lng}`
  navigator.clipboard.writeText(coordString)
  appService.toast.info('Coordinates copied to clipboard')
}

const useMultistopDirections = computed(() => {
  const filledWaypointsCount = waypoints.value.reduce(
    (count, waypoint) => (waypoint.lngLat ? count + 1 : count),
    0,
  )
  console.log(filledWaypointsCount, waypoints.value.length)
  return waypoints.value.length > 2 || filledWaypointsCount >= 2
})

function directionsTo() {
  router.push('/directions')
  directionsService.directionsTo({
    lngLat: clickedLngLat.value,
  })
}

function directionsFrom() {
  router.push('/directions')
  directionsService.directionsFrom({
    lngLat: clickedLngLat.value,
  })
}

function fillWaypoint() {
  router.push('/directions')
  setTimeout(() => {
    directionsService.fillWaypoint({
      lngLat: clickedLngLat.value,
    })
  }, 0)
}
</script>

<template>
  <div>
    <div ref="mapContainer" class="w-full h-full"></div>

    <DropdownMenu
      :open="showContextMenu"
      @update:open="showContextMenu = $event"
    >
      <div
        :style="{
          position: 'fixed',
          left: `${contextMenuPosition.x}px`,
          top: `${contextMenuPosition.y}px`,
        }"
      >
        <DropdownMenuTrigger> </DropdownMenuTrigger>
      </div>
      <DropdownMenuContent align="start" :side-offset="0">
        <DropdownMenuItem
          @click="copyCoordinates(clickedLngLat)"
          v-if="clickedLngLat"
        >
          {{ clickedLngLat.lat.toFixed(5) }}, {{ clickedLngLat.lng.toFixed(5) }}
        </DropdownMenuItem>
        <DropdownMenuItem
          v-if="!useMultistopDirections"
          @click="directionsTo()"
        >
          Directions to here
        </DropdownMenuItem>
        <DropdownMenuItem
          v-if="!useMultistopDirections"
          @click="directionsFrom()"
        >
          Directions from here
        </DropdownMenuItem>
        <DropdownMenuItem v-if="useMultistopDirections" @click="fillWaypoint()">
          Add stop
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
