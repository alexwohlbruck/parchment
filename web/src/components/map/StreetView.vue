<script setup lang="ts">
import { ref, onMounted, watch, defineProps, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import { Viewer, ViewerOptions } from 'mapillary-js'
import { useMapService } from '@/services/map.service'
import { useMapStore } from '@/stores/map.store'
import { StreetViewImage, StreetViewType } from '@/types/map.types'
import { Button } from '@/components/ui/button'
import { XIcon } from 'lucide-vue-next'
import { cn } from '@/lib/utils'

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
    viewer.remove()
  }
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

<template>
  <div class="relative">
    <div :class="cn($attrs.class ?? '', 'w-full h-full')" ref="container"></div>
    <Button
      variant="ghost"
      size="icon"
      class="absolute top-1 right-1 bg-black/50 hover:bg-black/70 text-white hover:text-white"
    >
      <XIcon class="size-5" @click="mapService.clearStreetView()" />
    </Button>
  </div>
</template>
