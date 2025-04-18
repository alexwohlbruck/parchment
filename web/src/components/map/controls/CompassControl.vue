<script setup lang="ts">
import { Button } from '@/components/ui/button'
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
  <Button
    variant="outline"
    size="icon-sm"
    class="rounded-md shadow-md"
    @click="mapService.resetNorth()"
    @mousedown.prevent="onDragStart"
    :class="{ 'cursor-grab': !isDragging, 'cursor-grabbing': isDragging }"
  >
    <CompassIcon class="size-5" :style="{ transform: compassTransform }" />
  </Button>
</template>
