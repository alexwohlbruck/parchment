<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Plus, Minus } from 'lucide-vue-next'
import { useMapService } from '@/services/map.service'
import { useMapCamera } from '@/composables/useMapCamera'
import { onMounted, onUnmounted, ref } from 'vue'
import CompassIcon from './CompassIcon.vue'

const mapService = useMapService()
const { camera, onCameraMove, compassTransform } = useMapCamera()

const isDragging = ref(false)
const startX = ref(0)
const startY = ref(0)
const startBearing = ref(0)
const startPitch = ref(0)

function onDragStart(e: MouseEvent) {
  isDragging.value = true
  startX.value = e.clientX
  startY.value = e.clientY
  startBearing.value = camera.value.bearing
  startPitch.value = camera.value.pitch

  window.addEventListener('mousemove', onDrag)
  window.addEventListener('mouseup', onDragEnd)
}

function onDrag(e: MouseEvent) {
  if (!isDragging.value) return

  const deltaX = e.clientX - startX.value
  const deltaY = e.clientY - startY.value

  const newBearing = startBearing.value + deltaX * 0.5
  const newPitch = Math.max(0, Math.min(85, startPitch.value - deltaY * 0.5))

  mapService.jumpTo({
    bearing: newBearing,
    pitch: newPitch,
  })
}

function onDragEnd() {
  isDragging.value = false
  window.removeEventListener('mousemove', onDrag)
  window.removeEventListener('mouseup', onDragEnd)
}

onMounted(() => {
  mapService.on('move', onCameraMove)
})

onUnmounted(() => {
  mapService.off('move', onCameraMove)
  window.removeEventListener('mousemove', onDrag)
  window.removeEventListener('mouseup', onDragEnd)
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
      @mousedown.prevent="onDragStart"
      :class="{ 'cursor-grab': !isDragging, 'cursor-grabbing': isDragging }"
    >
      <CompassIcon class="size-5" :style="{ transform: compassTransform }" />
    </Button>
  </div>
</template>
