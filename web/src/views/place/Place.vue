<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMapService } from '@/services/map.service'
import { MarkerIds } from '@/types/map.types'
import { LngLat } from 'mapbox-gl'
import { usePlaceService } from '@/services/place.service'
import { useAbortController } from '@/composables/useAbortController'
import Place from '@/components/place/Place.vue'
import { AppRoute } from '@/router'

const route = useRoute()
const router = useRouter()
const { currentPlace, loading, fetchPlaceDetails, fetchPlaceDetailsByCoordinates, clearPlace, setPartialPlace } =
  usePlaceService()
const { flyTo, fitBounds, addMarker, removeAllMarkers, updatePlacePolygon } = useMapService()
const { nextSignal } = useAbortController()

async function loadPlace() {
  // Don't clear place - keep partial data visible during loading
  // clearPlace() // REMOVED
  
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
    const place = await fetchPlaceDetails(`${type}/${id}`, 'osm', undefined, nextSignal())
    handlePlaceResult(place)
    return
  }

  // Case 2: Provider-specific ID
  if (typeof provider === 'string' && typeof placeId === 'string') {
    const place = await fetchPlaceDetails(placeId, provider, undefined, nextSignal())
    handlePlaceResult(place)
    return
  }

  // Case 3: Name + location lookup (legacy /place/location/:name/:lat/:lng format)
  if (typeof name === 'string' && typeof lat === 'string' && typeof lng === 'string') {
    const coordinates = {
      lat: parseFloat(lat),
      lng: parseFloat(lng),
    }

    // Immediately add marker and move camera for partial place data
    if (currentPlace.value?.geometry?.value?.center) {
      handlePlaceResult(currentPlace.value)
    }

    // Use name-based search for more accurate results
    const place = await fetchPlaceDetails(name, undefined, coordinates, nextSignal())
    handlePlaceResult(place)
    return
  }

  // Case 4: Coordinate-only lookup (new /place/coords/:lat/:lng format)
  if (typeof lat === 'string' && typeof lng === 'string') {
    const coordinates = {
      lat: parseFloat(lat),
      lng: parseFloat(lng),
    }

    // Immediately add marker and move camera for partial place data
    if (currentPlace.value?.geometry?.value?.center) {
      handlePlaceResult(currentPlace.value)
    }

    // Load full enriched place details
    const place = await fetchPlaceDetailsByCoordinates(
      coordinates.lat,
      coordinates.lng,
      undefined,
      nextSignal(),
    )
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
