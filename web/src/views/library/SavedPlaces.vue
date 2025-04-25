<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { MapPinIcon } from 'lucide-vue-next'
import PlacesList from '@/components/library/PlacesList.vue'
import EmptyState from '@/components/library/EmptyState.vue'
import { useLibraryService } from '@/services/library.service'
import type { SavedPlace } from '@/types/library.types'

const libraryService = useLibraryService()
const places = ref<SavedPlace[]>([])
const loading = ref(true)

onMounted(async () => {
  loading.value = true
  places.value = await libraryService.fetchPlaces()
  loading.value = false
})

// Check if there are no places and we're not loading
const showEmptyState = computed(() => {
  return !loading.value && places.value.length === 0
})
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- Show empty state when no places and not loading -->
    <EmptyState
      v-if="showEmptyState"
      :icon="MapPinIcon"
      entity-id="places"
      class="flex-1"
    />

    <!-- Show places list when we have places or are loading -->
    <PlacesList v-else :places="places" :loading="loading" />
  </div>
</template>
