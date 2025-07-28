<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'

import { FolderIcon } from 'lucide-vue-next'
import EmptyState from '@/components/library/EmptyState.vue'
import { useCollectionsService } from '@/services/library/collections.service'
import { useCollectionsStore } from '@/stores/library/collections.store'
import { storeToRefs } from 'pinia'
import CollectionsList from '@/components/library/CollectionsList.vue'
import Layers from '@/components/map/Layers.vue'

const collectionsService = useCollectionsService()
const collectionsStore = useCollectionsStore()
const { collections } = storeToRefs(collectionsStore)
const loadingCollections = ref(true)

onMounted(async () => {
  loadingCollections.value = true
  await collectionsService.fetchCollections()
  loadingCollections.value = false
})

const showEmptyState = computed(() => {
  return !loadingCollections.value && collections.value.length === 0
})

const loading = computed(() => {
  return loadingCollections.value && collections.value.length === 0
})
</script>

<template>
  <EmptyState
    v-if="showEmptyState"
    :icon="FolderIcon"
    entity-id="collections"
    class="flex-1"
  />

  <Layers v-else />
</template>
