<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { usePlaceSearchService } from '@/services/search.service'
import { useMapStore } from '@/stores/map.store'
import {
  searchResultToPlace,
  autocompleteResultToPlace,
} from '@/lib/search.utils'
import PlaceList from '@/components/place/PlaceList.vue'
import type { Place } from '@/types/place.types'

const props = defineProps<{
  query?: string
}>()

const placeSearchService = usePlaceSearchService()
const mapStore = useMapStore()

const places = ref<Place[]>([])
const loading = ref(false)
const searchQuery = ref(props.query || '')

async function performSearch() {
  loading.value = true

  try {
    const center = mapStore.mapCamera.center
    let lng, lat

    if (Array.isArray(center)) {
      ;[lng, lat] = center
    } else if (typeof center === 'object') {
      lng = 'lng' in center ? center.lng : 'lon' in center ? center.lon : 0
      lat = center.lat || 0
    }

    const results = await placeSearchService.search({
      query: searchQuery.value,
      lat,
      lng,
      autocomplete: false, // Get full search results with rich metadata
      maxResults: 100,
    })

    console.log('SearchResults: Raw results from API:', results)

    // Convert results to Place objects for display
    places.value = results.map(result => {
      console.log('SearchResults: Processing result:', result)

      // If the result is already a Place object (from bookmark search)
      if (
        'name' in result &&
        typeof result.name === 'object' &&
        'value' in result.name
      ) {
        console.log('SearchResults: Result is already a Place object')
        return result as Place
      }

      // Use the enhanced searchResultToPlace function for full search results
      console.log(
        'SearchResults: Converting SearchResult to Place using searchResultToPlace',
      )
      return searchResultToPlace(result)
    })

    console.log('SearchResults: Final places array:', places.value)
  } catch (error) {
    console.error('SearchResults: Error performing search:', error)
    places.value = []
  } finally {
    loading.value = false
  }
}

// Perform search when component mounts
onMounted(() => {
  performSearch() // Always perform search, even if query is empty (for nearby results)
})

// Watch for query changes (if navigating with different query params)
watch(
  () => props.query,
  newQuery => {
    searchQuery.value = newQuery || ''
    performSearch()
  },
)
</script>

<template>
  <div class="h-full">
    <!-- Results take up full space -->
    <PlaceList :places="places" :loading="loading" />
  </div>
</template>
