<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'

import { FolderIcon } from 'lucide-vue-next'
import LibraryEmptyState from '@/components/library/LibraryEmptyState.vue'
import { useCollectionsService } from '@/services/library/collections.service'
import { useCollectionsStore } from '@/stores/library/collections.store'
import { useConnectivity } from '@/composables/useConnectivity'
import { storeToRefs } from 'pinia'
import CollectionList from '@/components/library/collections/CollectionList.vue'

const collectionsService = useCollectionsService()
const collectionsStore = useCollectionsStore()
const { collections } = storeToRefs(collectionsStore)
const { isOffline, onReconnected } = useConnectivity()
const loadingCollections = ref(true)

async function load() {
  loadingCollections.value = true
  await collectionsService.fetchCollections()
  loadingCollections.value = false
}

onMounted(load)
// An empty list while offline usually just means the fetch never ran.
onReconnected(load)

const showEmptyState = computed(() => {
  return !loadingCollections.value && collections.value.length === 0
})

// Cached collections render normally offline; only a cache-less offline
// launch has nothing to show, and that's an offline state, not "no
// collections yet".
const showOffline = computed(
  () => showEmptyState.value && isOffline.value,
)

const loading = computed(() => {
  return loadingCollections.value && collections.value.length === 0
})
</script>

<template>
  <div class="min-h-full flex flex-col">
    <LibraryEmptyState
      v-if="showEmptyState"
      :icon="FolderIcon"
      entity-id="collections"
      :offline="showOffline"
      class="flex-1"
      @retry="load"
    />

    <CollectionList
      v-else
      :collections="collections"
      :loading="loading"
      class="flex-1"
    />
  </div>
</template>
