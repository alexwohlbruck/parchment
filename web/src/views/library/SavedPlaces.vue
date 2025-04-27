<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { MapPinIcon } from 'lucide-vue-next'
import PlacesList from '@/components/library/PlacesList.vue'
import EmptyState from '@/components/library/EmptyState.vue'
import { useSavedPlacesService } from '@/services/library/saved-places.service'
import { useSavedPlacesStore } from '@/stores/library/savedPlaces.store'
import { storeToRefs } from 'pinia'

const savedPlacesService = useSavedPlacesService()
const savedPlacesStore = useSavedPlacesStore()

const loadingPlaces = ref(false)
const { savedPlaces } = storeToRefs(savedPlacesStore)

onMounted(async () => {
  loadingPlaces.value = true
  await savedPlacesService.getSavedPlaces()
  loadingPlaces.value = false
})

const showEmptyState = computed(() => {
  return !loadingPlaces.value && savedPlaces.value.length === 0
})

const loading = computed(() => {
  return loadingPlaces.value && savedPlaces.value.length === 0
})
</script>

<template>
  <div class="h-full flex flex-col">
    <EmptyState
      v-if="showEmptyState"
      :icon="MapPinIcon"
      entity-id="places"
      class="flex-1"
    />

    <PlacesList v-else :places="savedPlaces" :loading="loading" />
  </div>
</template>
