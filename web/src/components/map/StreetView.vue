<template>
  <div ref="container" style="width: 100%; height: 100%"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, defineProps } from 'vue'
import { storeToRefs } from 'pinia'
import { Viewer, ViewerOptions } from 'mapillary-js'
import { useMapService } from '@/services/map.service'
import { useMapStore } from '@/stores/map.store'
import { StreetViewImage } from '@/types/map.types'

const container = ref()
let viewer: Viewer | null = null

const mapService = useMapService()
const { streetView } = storeToRefs(useMapStore())

onMounted(() => {
  if (!container.value) return

  const options: ViewerOptions = {
    accessToken: import.meta.env.VITE_MAPILLARY_ACCESS_TOKEN,
    container: container.value,
    imageId: streetView.value?.data.id.toString(),
    component: {
      cover: false,
    },
  }
  viewer = new Viewer(options)
  console.log(viewer)

  viewer.on('position', async e => {
    const position = await viewer!.getPosition()
    mapService.flyTo({ center: position })
  })
})

// Watch for changes to imageId and update the viewer
watch(
  () => streetView.value,
  async newStreetView => {
    if (viewer && newStreetView) {
      try {
        // Make sure viewer is activated before moving
        await viewer.moveTo(newStreetView.data.id.toString())
        mapService.flyTo({
          center: newStreetView.lngLat,
        })
      } catch (error) {
        console.error('Error moving to new image:', error)
      }
    }
  },
)
</script>
