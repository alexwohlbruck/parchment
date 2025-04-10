<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useMapService } from '@/services/map.service'
import { MarkerIds } from '@/types/map.types'
import { LngLat } from 'mapbox-gl'
import { usePlaceService } from '@/services/place.service'
import Place from '@/components/place/Place.vue'

const route = useRoute()
const { currentPlace, loading, fetchPlaceDetails, clearPlace } =
  usePlaceService()
const { flyTo, addMarker, removeAllMarkers } = useMapService()

async function loadPlace(type: string, id: string) {
  clearPlace()

  const place = await fetchPlaceDetails(id, type as any)

  // Add marker when place loads
  if (place && place.geometry) {
    const { lat, lng } = place.geometry.center

    if (lat && lng) {
      removeAllMarkers()
      addMarker(MarkerIds.SELECTED_POI, new LngLat(lng, lat))

      flyTo({
        center: new LngLat(lng, lat),
        zoom: 17,
      })
    }
  }
}

onMounted(async () => {
  const { type, id } = route.params
  if (typeof type === 'string' && typeof id === 'string') {
    await loadPlace(type, id)
  }
})

watch(
  () => route.params,
  async params => {
    const { type, id } = params
    if (typeof type === 'string' && typeof id === 'string') {
      await loadPlace(type, id)
    }
  },
)

onUnmounted(() => {
  removeAllMarkers()
})
</script>

<template>
  <Place :place="currentPlace" :loading="loading" />
</template>
