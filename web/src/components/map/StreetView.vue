<script setup lang="ts">
import { ref, onMounted, watch, defineProps, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import { Viewer, ViewerOptions } from 'mapillary-js'
import { useMapService } from '@/services/map.service'
import { useMapStore } from '@/stores/map.store'
import { cn } from '@/lib/utils'

const container = ref()
let viewer: Viewer | null = null

const mapService = useMapService()
const { streetView } = storeToRefs(useMapStore())

const props = defineProps<{
  pipSwapped: boolean
}>()

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

  viewer.on('pov', async e => {
    const pov = await e.target.getPointOfView()
    const position = await e.target.getPosition()
    const fov = await e.target.getFieldOfView()

    mapService.setPegman({
      pov,
      position,
      fov,
    })
  })
})

onUnmounted(() => {
  if (viewer) {
    // Wait for transition animation
    setTimeout(() => {
      viewer!.remove()
    }, 1000)
  }
})

watch(
  () => props.pipSwapped,
  () => {
    setTimeout(() => {
      viewer?.resize()
    }, 0)
  },
)

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

<template>
  <div :class="cn($attrs.class ?? '', 'w-full h-full')" ref="container"></div>
</template>
