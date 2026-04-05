<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import { LngLat } from 'mapbox-gl'
import { useDirectionsService } from '@/services/directions.service'
import { getPrimaryPhoto, getLogoPhoto } from '@/types/place.types'
import type { Place } from '@/types/place.types'
import { useAppService } from '@/services/app.service'
import { Skeleton } from '@/components/ui/skeleton'

import PlaceHeader from './header/PlaceHeader.vue'
import PlaceGallery from './gallery/PlaceGallery.vue'
import PlaceActions from './actions/PlaceActions.vue'
import PlaceSources from './sources/PlaceSources.vue'
import DetailsList from './details/DetailsList.vue'
import PlaceWidgets from './widgets/PlaceWidgets.vue'
import NearbyCategories from './NearbyCategories.vue'
import PlaceDisplayChips from './PlaceDisplayChips.vue'
import PanelLayout from '@/components/layouts/PanelLayout.vue'

const props = defineProps<{
  place: Partial<Place> | null
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
  return props.place.geometry.value.center
})

function sharePlace() {
  const url = window.location.href
  if (navigator.share) {
    try {
      const name = props.place?.name?.value ?? ''
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
    place: props.place,
  }

  directionsService.directionsTo(waypoint)
  router.push({ name: AppRoute.DIRECTIONS })
}

function handleDirectionsFromClick() {
  if (!coordinates.value) return

  const waypoint = {
    lngLat: new LngLat(coordinates.value.lng, coordinates.value.lat),
    place: props.place,
  }

  directionsService.directionsFrom(waypoint)
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
  <PanelLayout>
    <template v-if="place">
      <div class="flex flex-col space-y-3">
        <div class="flex flex-col space-y-3">
          <PlaceHeader
            :place="place"
            @close="router.push({ name: AppRoute.MAP })"
            @logoLoaded="handleBrandLogoLoad"
            @logoError="handleBrandLogoError"
          />

          <PlaceDisplayChips :place="place" />

          <PlaceActions
            :place="place"
            @directions="handleDirectionsClick"
            @directionsFrom="handleDirectionsFromClick"
            @share="sharePlace"
          />
        </div>

        <!-- Skeleton loaders while full data loads -->
        <template v-if="loading">
          <!-- Gallery skeleton -->
          <Skeleton
            class="ml-[-0.75rem] mr-[-0.75rem] w-[calc(100%+1.5rem)] h-48 rounded-lg"
          />
          <!-- Details skeleton -->
          <div class="space-y-3">
            <Skeleton class="h-5 w-3/4" />
            <Skeleton class="h-5 w-1/2" />
            <Skeleton class="h-5 w-2/3" />
          </div>
          <!-- Sources skeleton -->
          <div class="space-y-2">
            <Skeleton class="h-4 w-1/3" />
            <Skeleton class="h-4 w-1/4" />
          </div>
        </template>

        <template v-else>
          <PlaceGallery
            class="ml-[-0.75rem] mr-[-0.75rem] w-[calc(100%+1.5rem)]"
            :place="place"
            @imageLoaded="handlePlaceImageLoad"
            @imageError="handlePlaceImageError"
          />
          <DetailsList :place="place" />
          <PlaceWidgets :place="place" />
          <NearbyCategories :place="place" />
          <PlaceSources :place="place" />
        </template>
      </div>
    </template>
  </PanelLayout>
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
