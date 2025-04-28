<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { MapPinIcon } from 'lucide-vue-next'
import PlacesList from '@/components/library/PlacesList.vue'
import EmptyState from '@/components/library/EmptyState.vue'
import { useCollectionsService } from '@/services/library/collections.service'
import { useCollectionsStore } from '@/stores/library/collections.store'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'

const collectionsService = useCollectionsService()
const collectionsStore = useCollectionsStore()
const { t } = useI18n()

const loadingPlaces = ref(false)
const defaultCollection = ref<any>(null)

onMounted(async () => {
  loadingPlaces.value = true
  defaultCollection.value = await collectionsService.fetchDefaultCollection()
  loadingPlaces.value = false
})

const showEmptyState = computed(() => {
  return (
    !loadingPlaces.value &&
    (!defaultCollection.value ||
      !defaultCollection.value.places ||
      defaultCollection.value.places.length === 0)
  )
})

const loading = computed(() => {
  return (
    loadingPlaces.value &&
    (!defaultCollection.value ||
      !defaultCollection.value.places ||
      defaultCollection.value.places.length === 0)
  )
})

const places = computed(() => {
  return defaultCollection.value?.places || []
})

// Get the translated name for the default collection
const defaultCollectionName = computed(() => {
  if (defaultCollection.value?.name) {
    return defaultCollection.value.name
  }
  return t('library.entities.collections.default')
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

    <PlacesList
      v-else
      :places="places"
      :loading="loading"
      :collection-id="defaultCollection?.id"
    />
  </div>
</template>
