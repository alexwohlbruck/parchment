<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMapService } from '@/services/map.service'
import { MarkerIds } from '@/types/map.types'
import { LngLat } from 'mapbox-gl'
import { usePlaceService } from '@/services/place.service'
import Place from '@/components/place/Place.vue'
import { AppRoute } from '@/router'

const route = useRoute()
const router = useRouter()
const { currentPlace, loading, fetchPlaceDetails, clearPlace } =
  usePlaceService()
const { flyTo, fitBounds, addMarker, removeAllMarkers, updatePlacePolygon } = useMapService()

async function loadPlace() {
  clearPlace()
  // Clear any existing polygon
  updatePlacePolygon(null)

  const { type, id, provider, placeId, name, lat, lng } = route.params

  console.log(route.params)

  // Handle URL correction for nested routes
  // If we receive route parameters in incorrect positions, redirect to the correct route
  if (
    route.path.startsWith('/place/provider') ||
    route.path.startsWith('/place/location')
  ) {
    // Already in the correct route format
  } else if (
    provider === 'provider' &&
    typeof placeId === 'string' &&
    typeof id === 'string'
  ) {
    // Redirect to proper provider route
    router.replace({
      name: AppRoute.PLACE_PROVIDER,
      params: { provider: id, placeId },
    })
    return
  } else if (
    type === 'location' &&
    typeof id === 'string' &&
    typeof lat === 'string' &&
    typeof lng === 'string'
  ) {
    // Redirect to proper location route
    router.replace({
      name: AppRoute.PLACE_LOCATION,
      params: { name: id, lat, lng },
    })
    return
  }

  // Case 1: Legacy OSM route using type/id
  if (
    typeof type === 'string' &&
    typeof id === 'string' &&
    !['provider', 'location'].includes(type)
  ) {
    const place = await fetchPlaceDetails(`${type}/${id}`)
    handlePlaceResult(place)
    return
  }

  // Case 2: Provider-specific ID
  if (typeof provider === 'string' && typeof placeId === 'string') {
    const place = await fetchPlaceDetails(placeId, provider)
    handlePlaceResult(place)
    return
  }

  // Case 3: Name and coordinates
  if (
    typeof name === 'string' &&
    typeof lat === 'string' &&
    typeof lng === 'string'
  ) {
    // Note: Do not move camera here - wait for place data to load
    // This prevents double camera movement (once from coordinates, once from loaded data)
    const place = await fetchPlaceDetails('', '', {
      name,
      lat: parseFloat(lat),
      lng: parseFloat(lng),
    })
    handlePlaceResult(place)
    return
  }

  // If we get here, we don't have valid parameters
  console.error('Invalid route parameters for place lookup')
}

function handlePlaceResult(place: any) {
  // Add marker when place loads
  if (place && place.geometry) {
    const { lat, lng } = place.geometry.value.center

    if (lat && lng) {
      removeAllMarkers()
      addMarker(MarkerIds.SELECTED_POI, new LngLat(lng, lat))

      // Update polygon layer with place data
      updatePlacePolygon(place)

      // Use different camera behavior based on geometry type
      if (place.geometry.value.bounds && ['polygon', 'multipolygon', 'linestring'].includes(place.geometry.value.type)) {
        // For geometries with bounds data, fit the view to the geometry area with padding
        // The map service will automatically account for obstructing UI elements
        fitBounds(place.geometry.value.bounds, {
          padding: 50, // Additional padding around the geometry bounds
          duration: 1200,
          easing: (t) => t * (2 - t) // easeOutQuad for smooth animation
        })
      } else {
        // For points or geometries without bounds, use traditional flyTo with appropriate zoom
        const zoom = place.geometry.value.type === 'point' ? 17 : 16
        flyTo({
          center: new LngLat(lng, lat),
          zoom,
        })
      }
    }
  }
}

onMounted(async () => {
  await loadPlace()
})

watch(
  () => route.params,
  async () => {
    await loadPlace()
  },
)

onUnmounted(() => {
  removeAllMarkers()
  // Clear polygon when leaving place view
  updatePlacePolygon(null)
})
</script>

<template>
  <Place :place="currentPlace" :loading="loading" />
</template>
