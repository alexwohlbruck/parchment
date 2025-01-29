<script setup lang="ts">
import { ref, onMounted, watch, defineProps, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import { Viewer, ViewerOptions } from 'mapillary-js'
import { useMapService } from '@/services/map.service'
import { useMapStore } from '@/stores/map.store'
import { cn } from '@/lib/utils'
import { TransitionFade } from '@morev/vue-transitions'
import { Loader2Icon } from 'lucide-vue-next'
import { useResizeObserver } from '@vueuse/core'

let viewer: Viewer | null = null
const container = ref()
const loading = ref(false)

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

  viewer.on('dataloading', e => {
    loading.value = e.loading
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

// Add resize observer with debounce
useResizeObserver(container, () => {
  setTimeout(() => {
    viewer?.resize()
  }, 10)
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
  <div
    :class="cn($attrs.class ?? '', 'w-full h-full')"
    ref="container"
    class="relative"
  >
    <TransitionFade>
      <div
        v-if="loading"
        class="absolute inset-0 bg-black/30 flex items-center justify-center z-10"
      >
        <Loader2Icon class="size-8 animate-spin" />
      </div>
    </TransitionFade>
  </div>
</template>
