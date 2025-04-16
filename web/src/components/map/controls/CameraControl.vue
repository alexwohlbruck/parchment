<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Plus, Minus } from 'lucide-vue-next'
import { useMapService } from '@/services/map.service'
import { useMapStore } from '@/stores/map.store'
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import type { MapCamera } from '@/types/map.types'
import CompassIcon from './CompassIcon.vue'

const mapService = useMapService()
const mapStore = useMapStore()
const camera = ref<MapCamera>({
  center: [0, 0],
  zoom: 0,
  bearing: 0,
  pitch: 0,
})

const compassTransform = computed(() => {
  const { bearing = 0, pitch = 0 } = camera.value
  return `rotateX(${pitch}deg) rotateZ(${-bearing}deg)`
})

function onCameraMove(newCamera: MapCamera) {
  console.log('onCameraMove', newCamera)
  camera.value = newCamera
}

onMounted(() => {
  camera.value = mapStore.mapCamera
  mapService.on('move', onCameraMove)
})

onUnmounted(() => {
  mapService.off('move', onCameraMove)
})
</script>

<template>
  <div class="flex flex-col">
    <Button
      variant="outline"
      size="icon-sm"
      class="rounded-none rounded-t-md"
      @click="mapService.zoomIn()"
    >
      <Plus class="size-4" strokeWidth="2.75" />
    </Button>
    <Button
      variant="outline"
      size="icon-sm"
      class="rounded-none border-y-0"
      @click="mapService.zoomOut()"
    >
      <Minus class="size-4" strokeWidth="2.75" />
    </Button>
    <Button
      variant="outline"
      size="icon-sm"
      class="rounded-none rounded-b-md"
      @click="mapService.resetNorth()"
    >
      <CompassIcon class="size-5" :style="{ transform: compassTransform }" />
    </Button>
  </div>
</template>
