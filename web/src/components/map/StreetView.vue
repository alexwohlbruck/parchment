<script setup lang="ts">
import { ref, onMounted, watch, onUnmounted } from 'vue'
import { useResizeObserver } from '@vueuse/core'
import { useRouter, useRoute } from 'vue-router'
import { Viewer, ViewerOptions } from 'mapillary-js'
import { useMapService } from '@/services/map.service'
import { cn, useResponsive } from '@/lib/utils'
import { TransitionFade } from '@morev/vue-transitions'
import { Loader2Icon } from 'lucide-vue-next'
import { updatePegmanData } from '@/lib/pegman.utils'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { usePlaceService } from '@/services/place.service'
import { IntegrationId } from '@server/types/integration.types'
import type { Image as MapillaryViewerImage } from 'mapillary-js'

let viewer: Viewer | null = null
const container = ref()
const loading = ref(false)
// Face the place we opened from on the first image only (à la Google Maps).
let hasFacedTarget = false

const mapService = useMapService()
const integrationsStore = useIntegrationsStore()
const { currentPlace } = usePlaceService()
const { isMobileScreen } = useResponsive()

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

/** Initial compass bearing (degrees) from one coordinate to another. */
function bearingBetween(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const toDeg = (r: number) => (r * 180) / Math.PI
  const φ1 = toRad(lat1)
  const φ2 = toRad(lat2)
  const Δλ = toRad(lng2 - lng1)
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

/**
 * Point the viewer toward the place we opened street view from, like Google
 * Maps. Only 360° (spherical) panos can be rotated to an arbitrary bearing;
 * perspective images keep their captured forward view.
 */
function faceTarget(image: MapillaryViewerImage) {
  if (image.cameraType !== 'spherical') return
  const center = currentPlace.value?.geometry?.value?.center
  const lngLat = image.lngLat
  if (!center || !lngLat) return

  const bearing = bearingBetween(lngLat.lat, lngLat.lng, center.lat, center.lng)
  // Basic image x ∈ [0,1] spans 360°, centered (x = 0.5) on the compass angle.
  let x = 0.5 + (bearing - image.compassAngle) / 360
  x = ((x % 1) + 1) % 1
  viewer?.setCenter([x, 0.5])
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
    if (!hasFacedTarget) {
      hasFacedTarget = true
      faceTarget(e.image)
    }
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
  // Navigation is route-driven (the close button / back button decide where to
  // go). Unmounting must not force a destination, or it would override the
  // "return to the previous page" behaviour.
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
    :class="cn($attrs.class ?? '', 'w-full h-full', isMobileScreen && 'sv-pip-top')"
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

<style scoped>
/*
 * Mobile street view: the pip (map) sits full-width at the top, so push
 * Mapillary's own sequence/timeline controls down to just below it. The pip is
 * `aspect-video` (9/16) of the full viewport width minus the p-2 (1rem) gutter.
 */
.sv-pip-top :deep(.mapillary-sequence-stepper) {
  top: calc(
    env(safe-area-inset-top, 0px) + (100vw - 1rem) * 0.5625 + 0.75rem
  ) !important;
}
</style>
