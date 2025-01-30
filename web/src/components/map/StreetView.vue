<script setup lang="ts">
import { ref, onMounted, watch, defineProps, onUnmounted } from 'vue'
import { useResizeObserver, useUrlSearchParams } from '@vueuse/core'
import { useRouter, useRoute } from 'vue-router'
import { AppRoute } from '@/router'
import { storeToRefs } from 'pinia'
import { Viewer, ViewerOptions } from 'mapillary-js'
import { useMapService } from '@/services/map.service'
import { useMapStore } from '@/stores/map.store'
import { cn } from '@/lib/utils'
import { TransitionFade } from '@morev/vue-transitions'
import { Loader2Icon } from 'lucide-vue-next'

let viewer: Viewer | null = null
const container = ref()
const loading = ref(false)

const mapService = useMapService()

const props = defineProps<{
  pipSwapped: boolean
}>()

const router = useRouter()
const route = useRoute()

onMounted(() => {
  if (!container.value) return

  console.log(route.params)

  const options: ViewerOptions = {
    accessToken: import.meta.env.VITE_MAPILLARY_ACCESS_TOKEN,
    container: container.value,
    imageId: route.params.id as string,
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

    const image = await viewer!.getImage()

    router.replace({
      params: {
        id: image.id,
      },
      query: route.query,
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
  router.push({
    name: AppRoute.MAP,
  })
})

// Add resize observer with debounce
useResizeObserver(container, () => {
  setTimeout(() => {
    viewer?.resize()
  }, 10)
})

watch(
  () => props.pipSwapped,
  newValue => {
    router.replace({
      query: {
        ...route.query,
        large: newValue ? 'true' : undefined,
      },
    })
    setTimeout(() => {
      viewer?.resize()
    }, 0)
  },
)

// Watch for changes to imageId and update the viewer
watch(
  () => route.params.id,
  async newStreetView => {
    if (viewer && newStreetView && newStreetView !== route.params.id) {
      try {
        router.replace({
          name: AppRoute.STREET,
          params: {
            id: newStreetView,
          },
          query: route.query,
        })
        // Make sure viewer is activated before moving
        await viewer.moveTo(newStreetView as string)
        const position = await viewer.getPosition()
        mapService.flyTo({
          center: position,
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
