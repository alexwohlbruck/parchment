<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useRouter } from 'vue-router'
import { Spinner } from '@/components/ui/spinner'
import { AppRoute } from '@/router'
import { LngLat } from 'mapbox-gl'
import { useDirectionsService } from '@/services/directions.service'
import { getPrimaryPhoto, getLogoPhoto } from '@/types/unified-place.types'
import type { UnifiedPlace } from '@/types/unified-place.types'
import { useAppService } from '@/services/app.service'

import PlaceHeader from './header/PlaceHeader.vue'
import PlaceGallery from './gallery/PlaceGallery.vue'
import PlaceActions from './actions/PlaceActions.vue'
import PlaceSources from './sources/PlaceSources.vue'
import DetailsList from './details/DetailsList.vue'

const props = defineProps<{
  place: UnifiedPlace | null
  loading: boolean
}>()

const router = useRouter()
const { toast } = useAppService()
const directionsService = useDirectionsService()

const imageLoading = ref(false)
const logoLoading = ref(false)
const imageError = ref(false)
const logoError = ref(false)
const placeImageLoaded = ref(false)
const brandLogoLoaded = ref(false)
const currentPhotoIndex = ref(0)

// Reset loading and error states when place changes
watch(
  () => props.place,
  newPlace => {
    if (newPlace) {
      const primaryPhoto = getPrimaryPhoto(newPlace)
      const logoPhoto = getLogoPhoto(newPlace)
      imageLoading.value = !!primaryPhoto && !placeImageLoaded.value
      logoLoading.value = !!logoPhoto && !brandLogoLoaded.value
      imageError.value = false
      logoError.value = false
      placeImageLoaded.value = false
      currentPhotoIndex.value = 0
    }
  },
)

const coordinates = computed(() => {
  if (!props.place?.geometry) return null
  return props.place.geometry.center
})

function sharePlace() {
  const url = window.location.href
  if (navigator.share) {
    try {
      const name = props.place?.name || ''
      navigator.share({
        url,
        title: name,
        text: name,
      })
      return
    } catch (err) {
      navigator.clipboard.writeText(url)
      toast.info('Link copied to clipboard')
    }
  }
}

function handleDirectionsClick() {
  if (!coordinates.value) return

  const waypoint = {
    lngLat: new LngLat(coordinates.value.lng, coordinates.value.lat),
  }

  directionsService.directionsTo(waypoint)
  router.push({ name: AppRoute.DIRECTIONS })
}

function handlePlaceImageLoad() {
  placeImageLoaded.value = true
  imageLoading.value = false
}

function handleBrandLogoLoad() {
  brandLogoLoaded.value = true
  logoLoading.value = false
}

function handlePlaceImageError() {
  imageError.value = true
  imageLoading.value = false
}

function handleBrandLogoError() {
  logoError.value = true
  logoLoading.value = false
}
</script>

<template>
  <div class="h-full flex flex-col relative">
    <div
      v-if="loading"
      class="h-full p-4 flex items-center justify-center py-8"
    >
      <Spinner class="w-6 h-6" />
    </div>

    <template v-else-if="place">
      <div class="flex flex-col gap-4 pt-4">
        <div class="px-4">
          <PlaceHeader
            :place="place"
            @close="router.push({ name: AppRoute.MAP })"
            @logoLoaded="handleBrandLogoLoad"
            @logoError="handleBrandLogoError"
          />

          <PlaceActions
            class="mt-4"
            @directions="handleDirectionsClick"
            @share="sharePlace"
          />
        </div>

        <PlaceGallery
          :place="place"
          @imageLoaded="handlePlaceImageLoad"
          @imageError="handlePlaceImageError"
        />

        <div class="px-4">
          <DetailsList :place="place" />
          <PlaceSources :place="place" class="mt-4" />
        </div>
      </div>
    </template>
  </div>
</template>

<style>
.snap-x::-webkit-scrollbar {
  display: none;
}
.snap-x {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
</style>
