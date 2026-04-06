<script setup lang="ts">
import { ref, onMounted, watch, onUnmounted } from 'vue'
import { useResizeObserver } from '@vueuse/core'
import { useRouter, useRoute } from 'vue-router'
import { AppRoute } from '@/router'
import { Viewer, ViewerOptions } from 'mapillary-js'
import { useMapService } from '@/services/map.service'
import { cn } from '@/lib/utils'
import { TransitionFade } from '@morev/vue-transitions'
import { Loader2Icon } from 'lucide-vue-next'
import { updatePegmanData } from '@/lib/pegman.utils'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { IntegrationId } from '@server/types/integration.types'

let viewer: Viewer | null = null
const container = ref()
const loading = ref(false)

const mapService = useMapService()
const integrationsStore = useIntegrationsStore()

const props = defineProps<{
  pipSwapped: boolean
}>()

const router = useRouter()
const route = useRoute()

function getMapillaryAccessToken(): string | undefined {
  return integrationsStore.getIntegrationConfigValue(
    IntegrationId.MAPILLARY,
    'accessToken',
  ) as string | undefined
}

async function updatePegman(viewer: Viewer) {
  const pov = await viewer.getPointOfView()
  const position = await viewer.getPosition()
  const fov = await viewer.getFieldOfView()

  mapService.setPegman({
    pov,
    position,
    fov,
  })

  mapService.jumpTo({
    center: position,
  })
}

onMounted(async () => {
  if (!container.value) return

  const token =
    getMapillaryAccessToken() ||
    import.meta.env.VITE_MAPILLARY_ACCESS_TOKEN

  const options: ViewerOptions = {
    accessToken: token,
    container: container.value,
    imageId: route.params.id as string,
    component: {
      cover: false,
    },
  }
  viewer = new Viewer(options)

  viewer.on('pov', async e => {
    updatePegman(e.target as Viewer)
  })

  viewer.on('position', async e => {
    updatePegman(e.target as Viewer)
  })

  viewer.on('image', e => {
    router.replace({
      params: {
        id: e.image.id,
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
    viewer!.remove()
  }
  mapService.clearPegman()
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
    const currentImage = await viewer!.getImage()
    if (viewer && newStreetView && newStreetView !== currentImage.id) {
      await viewer.moveTo(newStreetView as string)
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
        <Loader2Icon class="size-8 animate-spin text-white" />
      </div>
    </TransitionFade>
  </div>
</template>
