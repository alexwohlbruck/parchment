<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Plus, Minus } from 'lucide-vue-next'
import { useMapService } from '@/services/map.service'
import { useMapCamera } from '@/composables/useMapCamera'
import { onMounted, onUnmounted } from 'vue'
import CompassIcon from './CompassIcon.vue'

const mapService = useMapService()
const { camera, onCameraMove, compassTransform } = useMapCamera()

onMounted(() => {
  mapService.on('move', onCameraMove)
})

onUnmounted(() => {
  mapService.off('move', onCameraMove)
})
</script>

<template>
  <div class="flex flex-col shadow-md rounded-md">
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
